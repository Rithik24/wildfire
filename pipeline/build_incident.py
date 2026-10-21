"""Turn raw VIIRS detections into the incident package the web app reads.

Products (written to public/data/<incident>/):

  incident.json   metadata, grid, overpasses, time series, daily stats, events,
                  reported facts and sources
  arrival.png     fire arrival time per grid cell (R,G = uint16 in 5-min steps
                  since the incident start, 65535 = never burned; B = peak
                  fire radiative power class; A = 255)
  perimeters.json daily cumulative burned-area polygons (GeoJSON)
  detections.json every VIIRS fire pixel (columnar)
  hotspots.json   hot spots tracked from overpass to overpass

Method (documented in the app's Methods page):

* Each fire pixel paints a nominal 375 m footprint onto a ~100 m Web Mercator
  grid with its observation time; the earliest observation wins.
* The burned area at each overpass is the morphological closing of every
  footprint seen so far (gaps between neighbouring pixels are filled), with
  enclosed unburned islands smaller than `max_hole_ha` filled too.
* Cells first burned at overpass k get a time between the previous overpass
  that looked at the area and k, proportional to their distance from the
  burned area of the previous overpass (the front is assumed to advance at
  constant speed between looks). Without a previous burned area (the first
  pass) the distance is measured from the reported origin when known.
"""

import argparse
import datetime as dt
import json
import math
import os

import numpy as np
from PIL import Image
from rasterio import features
from scipy import ndimage
from shapely.geometry import mapping, shape
from shapely.ops import transform as shp_transform

from .grid import Grid, TO_4326
from .incidents import INCIDENTS

STEP_MIN = 5  # arrival time resolution in the PNG
NEVER = 65535


def parse_time(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def iso(t):
    return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_detections(path):
    import csv
    rows = list(csv.DictReader(open(path)))
    rows = [r for r in rows if int(r["persistent"]) == 0]  # drop static thermal anomalies
    d = {
        "t": np.array([parse_time(r["time"]).timestamp() for r in rows]),
        "lon": np.array([float(r["lon"]) for r in rows]),
        "lat": np.array([float(r["lat"]) for r in rows]),
        "frp": np.array([float(r["frp"]) for r in rows]),
        "mask": np.array([int(r["fire_mask"]) for r in rows]),
        "day": np.array([int(r["day"]) for r in rows]),
        "zen": np.array([float(r["sat_zenith"]) for r in rows]),
        "sat": np.array([r["satellite"] for r in rows]),
        "bt4": np.array([float(r["bt4"]) for r in rows]),
    }
    return d


def load_granules(path):
    import csv
    return [(parse_time(r["start"]).timestamp(), r["satellite"]) for r in csv.DictReader(open(path))]


def choose_bbox(inc, det):
    """For regional incidents, centre the bbox on the densest burning area."""
    if inc["bbox"]:
        return inc["bbox"]
    w, s, e, n = inc["search_bbox"]
    bw, bh = inc["bbox_size_deg"]
    best, score = None, -1
    for cx in np.arange(w + bw / 2, e - bw / 2 + 1e-9, 0.05):
        for cy in np.arange(s + bh / 2, n - bh / 2 + 1e-9, 0.05):
            sel = (np.abs(det["lon"] - cx) <= bw / 2) & (np.abs(det["lat"] - cy) <= bh / 2)
            sc = sel.sum()
            if sc > score:
                best, score = (cx, cy), sc
    cx, cy = best
    return [round(float(v), 3) for v in (cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2)]


def group_overpasses(granules, gap_s=20 * 60):
    """Granules from the same satellite within 20 min are one overpass."""
    out = []
    for t, sat in sorted(granules):
        if out and out[-1]["sat"] == sat and t - out[-1]["t1"] < gap_s:
            out[-1]["t1"] = t
        else:
            out.append({"t0": t, "t1": t, "sat": sat})
    return out


def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def build(incident_id, raw_dir, out_dir, res_m=100, close_m=450, max_hole_ha=300, fp_half_m=187.5, stretch=True, shrink_m=0, write=True, use_s2=True, dnbr_min=0.1):
    inc = INCIDENTS[incident_id]
    det = load_detections(os.path.join(raw_dir, incident_id, "detections.csv"))
    bbox = choose_bbox(inc, det)
    sel = (det["lon"] >= bbox[0]) & (det["lon"] <= bbox[2]) & (det["lat"] >= bbox[1]) & (det["lat"] <= bbox[3])
    t_start = parse_time(inc["start"]).timestamp()
    t_end = parse_time(inc["end"]).timestamp()
    sel &= (det["t"] >= t_start - 6 * 3600) & (det["t"] <= t_end)
    det = {k: v[sel] for k, v in det.items()}
    order = np.argsort(det["t"])
    det = {k: v[order] for k, v in det.items()}
    t0 = min(t_start, det["t"].min())
    n_det = len(det["t"])
    print(f"{incident_id}: {n_det} detections, bbox {bbox}")

    g = Grid(bbox, res_m)
    H, W = g.height, g.width
    col, row = g.to_pixel(det["lon"], det["lat"])

    # Overpasses that looked at the bbox (with or without detections).
    granules = load_granules(os.path.join(raw_dir, incident_id, "granules.csv"))
    passes = group_overpasses([x for x in granules if t0 - 6 * 3600 <= x[0] <= t_end])
    for p in passes:
        m = (det["t"] >= p["t0"] - 120) & (det["t"] <= p["t1"] + 200) & (det["sat"] == p["sat"])
        p["idx"] = np.nonzero(m)[0]
        p["t"] = float(np.median(det["t"][m])) if m.any() else p["t0"]
    passes = [p for p in passes if p["t"] >= t0 - 3600]

    # 1. Paint footprints: earliest observation per cell.
    half = fp_half_m / res_m
    obs = np.full((H, W), np.inf)
    peak_frp = np.zeros((H, W))
    for i in range(n_det):
        k = min(1.0 / max(math.cos(math.radians(det["zen"][i])), 0.35) ** 0.5, 1.6) if stretch else 1.0
        hx = half * k
        c0, c1 = int(math.floor(col[i] - hx)), int(math.ceil(col[i] + hx))
        r0, r1 = int(math.floor(row[i] - hx)), int(math.ceil(row[i] + hx))
        c0, r0 = max(c0, 0), max(r0, 0)
        c1, r1 = min(c1, W), min(r1, H)
        if c0 >= c1 or r0 >= r1:
            continue
        sub = obs[r0:r1, c0:c1]
        np.minimum(sub, det["t"][i], out=sub)
        sp = peak_frp[r0:r1, c0:c1]
        np.maximum(sp, det["frp"][i], out=sp)

    # 2. Burned area after each overpass with detections, and arrival times.
    close_r = max(1, int(round(close_m / res_m)))
    st = disk(close_r)
    max_hole_cells = max_hole_ha / g.cell_area_ha
    shrink_st = disk(max(1, int(round(shrink_m / res_m)))) if shrink_m > 0 else None
    arrival = np.full((H, W), np.inf)
    burned_prev = np.zeros((H, W), bool)
    origin_px = None
    if inc.get("origin"):
        oc, orow = g.to_pixel(*inc["origin"])
        origin_px = (float(orow), float(oc))
    prev_look = t_start
    pass_stats = []
    times_with_det = sorted({p["t"] for p in passes if len(p["idx"])})
    for p in passes:
        tp = p["t"]
        if len(p["idx"]) == 0:
            pass_stats.append({"t": tp, "sat": p["sat"], "n": 0, "frp": 0.0, "day": None})
            prev_look = max(prev_look, tp)
            continue
        seen = obs <= tp + 300
        pad = close_r + 2
        padded = np.pad(seen, pad)
        closed = ndimage.binary_closing(padded, structure=st)[pad:-pad, pad:-pad]
        filled = ndimage.binary_fill_holes(closed)
        holes = filled & ~closed
        if holes.any():
            lab, nlab = ndimage.label(holes)
            sizes = ndimage.sum(holes, lab, index=np.arange(1, nlab + 1))
            small = np.zeros(nlab + 1, bool)
            small[1:] = sizes <= max_hole_cells
            closed |= small[lab]
        if shrink_m > 0:
            closed = ndimage.binary_erosion(closed, structure=shrink_st)
        burned = closed | burned_prev
        new = burned & ~burned_prev
        if new.any():
            if burned_prev.any():
                dist = ndimage.distance_transform_edt(~burned_prev)
            elif origin_px is not None:
                rr, cc = np.indices((H, W))
                dist = np.hypot(rr - origin_px[0], cc - origin_px[1])
            else:
                dist = np.zeros((H, W))
            dnew = dist[new]
            dmax = np.percentile(dnew, 95) if dnew.size > 10 else (dnew.max() if dnew.size else 1)
            frac = np.clip(dnew / max(dmax, 1e-6), 0, 1)
            lo = max(prev_look, t_start if not burned_prev.any() else prev_look)
            if not burned_prev.any():
                lo = min(t_start, tp - 3600)
            arrival[new] = lo + frac * (tp - lo)
        burned_prev = burned
        prev_look = tp
        idx = p["idx"]
        pass_stats.append({
            "t": tp, "sat": p["sat"], "n": int(len(idx)), "frp": float(det["frp"][idx].sum()),
            "frp_max": float(det["frp"][idx].max()), "day": int(round(det["day"][idx].mean())),
        })

    viirs_area_ha = float(np.isfinite(arrival).sum() * g.cell_area_ha)
    print(f"{incident_id}: VIIRS-only burned area {viirs_area_ha:,.0f} ha")

    # 2b. Refine the burned footprint with the Sentinel-2 burn scar (dNBR), keep VIIRS timing.
    dnbr_grid = None
    s2_path = os.path.join(raw_dir, incident_id, "s2.npz")
    scar_method = "viirs"
    if use_s2 and os.path.exists(s2_path):
        sc = inc.get("scar", {})
        dnbr_min = sc.get("dnbr_min", dnbr_min)
        nbr_post_max = sc.get("nbr_post_max", 1.0)
        arrival, dnbr_grid, scar_stats = refine_with_s2(arrival, g, s2_path, os.path.join(raw_dir, incident_id, "s2.json"),
                                                        dnbr_min, nbr_post_max)
        write_severity(arrival, g, s2_path, os.path.join(raw_dir, incident_id, "s2.json"), out_dir if write else None,
                       dnbr_min, nbr_post_max)
        scar_method = "s2-dnbr"
        print(f"{incident_id}: S2 refinement {scar_stats}")

    burned_final = np.isfinite(arrival)
    area_final_ha = float(burned_final.sum() * g.cell_area_ha)
    print(f"{incident_id}: burned (derived) {area_final_ha:,.0f} ha = {area_final_ha / 0.404686:,.0f} acres")
    if not write:
        return area_final_ha

    # 3. Encode arrival PNG.
    minutes = np.where(burned_final, (arrival - t0) / 60.0 / STEP_MIN, NEVER)
    minutes = np.clip(np.round(minutes), 0, NEVER - 1).astype(np.uint32)
    minutes[~burned_final] = NEVER
    if dnbr_grid is not None:  # B = burn severity, dNBR 0..1.27 -> 0..254 (255 = no data)
        b_chan = np.where(np.isfinite(dnbr_grid), np.clip(dnbr_grid / 1.27 * 254, 0, 254), 255).astype(np.uint8)
    else:  # B = peak FRP class
        b_chan = np.where(peak_frp > 0, np.clip(np.log10(peak_frp + 1) / 3.0 * 255, 1, 255), 0).astype(np.uint8)
    rgba = np.zeros((H, W, 4), np.uint8)
    rgba[..., 0] = (minutes >> 8) & 255
    rgba[..., 1] = minutes & 255
    rgba[..., 2] = b_chan
    rgba[..., 3] = 255
    os.makedirs(out_dir, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(os.path.join(out_dir, "arrival.png"), optimize=True)

    # 4. Time series on an hourly clock + per overpass.
    tz_off = local_offset_hours(inc["timezone"], t0)
    hours = np.arange(math.floor(t0 / 3600) * 3600, t_end + 1, 3600)
    arr_flat = np.sort(arrival[burned_final].ravel())
    area_h = np.searchsorted(arr_flat, hours, side="right") * g.cell_area_ha
    for ps in pass_stats:
        ps["area_ha"] = float(np.searchsorted(arr_flat, ps["t"], side="right") * g.cell_area_ha)

    # 5. Daily perimeters (local midnight) + spread metrics.
    days = []
    perim_features = []
    d0 = dt.datetime.fromtimestamp(t0 + tz_off * 3600, dt.timezone.utc).date()
    day = d0
    prev_mask = np.zeros((H, W), bool)
    while True:
        end_local = dt.datetime.combine(day + dt.timedelta(days=1), dt.time()).replace(tzinfo=dt.timezone.utc)
        t_cut = end_local.timestamp() - tz_off * 3600
        mask = arrival <= t_cut
        grown = mask & ~prev_mask
        area = float(mask.sum() * g.cell_area_ha)
        growth = float(grown.sum() * g.cell_area_ha)
        advance_km, bearing = 0.0, None
        if grown.any() and prev_mask.any():
            dist = ndimage.distance_transform_edt(~prev_mask)
            dg = dist[grown]
            advance_km = float(np.percentile(dg, 98) * res_m / 1000)
            # direction of the farthest growth relative to the previous burned centroid
            far = grown & (dist >= np.percentile(dg, 90))
            pr, pc = ndimage.center_of_mass(prev_mask)
            fr, fc = ndimage.center_of_mass(far)
            bearing = float((math.degrees(math.atan2(fc - pc, -(fr - pr))) + 360) % 360)
        frp_day = float(det["frp"][(det["t"] > t_cut - 86400) & (det["t"] <= t_cut)].sum())
        n_day = int(((det["t"] > t_cut - 86400) & (det["t"] <= t_cut)).sum())
        days.append({
            "date": day.isoformat(), "t_end": t_cut, "area_ha": area, "growth_ha": growth,
            "advance_km": round(advance_km, 2), "bearing": bearing, "detections": n_day, "frp_sum": round(frp_day, 1),
        })
        if mask.any() and growth > 0:
            geom = mask_to_lonlat(mask, g, simplify_m=max(60, 1.5 * res_m))
            if geom is not None:
                perim_features.append({
                    "type": "Feature", "geometry": geom,
                    "properties": {"date": day.isoformat(), "t": t_cut, "area_ha": round(area, 1), "growth_ha": round(growth, 1)},
                })
        prev_mask = mask
        day += dt.timedelta(days=1)
        if t_cut >= t_end:
            break

    # 6. Hot-spot tracking.
    tracks = track_hotspots(det, passes, g)

    # 7. Detections (columnar).
    det_out = {
        "t": [int(round((x - t0) / 60)) for x in det["t"]],  # minutes since t0
        "lon": [round(float(x), 4) for x in det["lon"]],
        "lat": [round(float(x), 4) for x in det["lat"]],
        "frp": [round(float(x), 1) for x in det["frp"]],
        "conf": [int(x) - 7 for x in det["mask"]],  # 0 low, 1 nominal, 2 high
        "sat": [["S-NPP", "NOAA-20", "NOAA-21"].index(x) for x in det["sat"]],
        "day": [int(x) for x in det["day"]],
    }
    with open(os.path.join(out_dir, "detections.json"), "w") as f:
        json.dump(det_out, f, separators=(",", ":"))
    with open(os.path.join(out_dir, "perimeters.json"), "w") as f:
        json.dump({"type": "FeatureCollection", "features": perim_features}, f, separators=(",", ":"))
    with open(os.path.join(out_dir, "hotspots.json"), "w") as f:
        json.dump(tracks, f, separators=(",", ":"))

    events = build_events(inc, det, pass_stats, days, area_final_ha, t0, tz_off)

    meta = {
        "id": incident_id,
        "name": inc["name"],
        "region": inc["region"],
        "country": inc["country"],
        "timezone": inc["timezone"],
        "utc_offset_h": tz_off,
        "bbox": bbox,
        "center": [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
        "origin": inc.get("origin"),
        "t0": iso(dt.datetime.fromtimestamp(t0, dt.timezone.utc)),
        "t0_epoch": t0,
        "start": inc["start"],
        "end": inc["end"],
        "grid": g.describe(),
        "arrival_step_min": STEP_MIN,
        "method": {"res_m": res_m, "close_m": close_m, "max_hole_ha": max_hole_ha, "footprint_m": 375,
                   "scar": scar_method, "dnbr_min": inc.get("scar", {}).get("dnbr_min", dnbr_min),
                   "nbr_post_max": inc.get("scar", {}).get("nbr_post_max"), "viirs_only_area_ha": round(viirs_area_ha, 1),
                   "b_channel": "dnbr" if dnbr_grid is not None else "frp"},
        "stats": {
            "detections": n_det,
            "overpasses": len(pass_stats),
            "overpasses_with_fire": sum(1 for p in pass_stats if p["n"]),
            "area_ha": round(area_final_ha, 1),
            "peak_frp_mw": round(max((p["frp"] for p in pass_stats), default=0), 1),
            "first_detection": iso(dt.datetime.fromtimestamp(det["t"][0], dt.timezone.utc)),
            "last_detection": iso(dt.datetime.fromtimestamp(det["t"][-1], dt.timezone.utc)),
            "hotspots": len(tracks["tracks"]),
            "satellites": {s: int((det["sat"] == s).sum()) for s in ["S-NPP", "NOAA-20", "NOAA-21"]},
        },
        "hourly": {
            "t": [int(x) for x in hours],
            "area_ha": [round(float(x), 1) for x in area_h],
        },
        "passes": [
            {k: (round(v, 1) if isinstance(v, float) else v) for k, v in ps.items()} for ps in pass_stats
        ],
        "days": days,
        "events": events,
        "reported": inc.get("reported", {}),
        "base": inc["base"],
        "icp": inc["icp"],
        "fleet": inc["fleet"],
    }
    s2_info = os.path.join(raw_dir, incident_id, "s2.json")
    if os.path.exists(s2_info):
        info = json.load(open(s2_info))
        meta["imagery"] = {
            "corners": info["grid"]["corners"], "res_m": info["grid"]["res_m"],
            "width": info["grid"]["width"], "height": info["grid"]["height"],
            "pre": info["pre"], "post": info["post"], "severity_classes": info["severity_classes"],
        }
        write_thumbnail(out_dir)
    with open(os.path.join(out_dir, "incident.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))
    return meta


def write_thumbnail(out_dir, width=480):
    post = os.path.join(out_dir, "s2_post.jpg")
    sev = os.path.join(out_dir, "severity.png")
    if not (os.path.exists(post) and os.path.exists(sev)):
        return
    a = Image.open(post).convert("RGBA")
    b = Image.open(sev)
    a.alpha_composite(b)
    h = int(a.height * width / a.width)
    a.convert("RGB").resize((width, h), Image.LANCZOS).save(os.path.join(out_dir, "thumb.jpg"), quality=80)


def write_severity(arrival, g, npz_path, info_path, out_dir, dnbr_min, nbr_post_max):
    """Severity classes on the imagery grid, limited to the final burn scar."""
    if out_dir is None:
        return
    from rasterio.warp import reproject, Resampling
    from rasterio.transform import from_origin
    z = np.load(npz_path)
    sg = json.load(open(info_path))["grid"]
    tr = from_origin(sg["x0"], sg["y1"], sg["res_mercator"], sg["res_mercator"])
    scar = np.zeros((sg["height"], sg["width"]), np.uint8)
    reproject(np.isfinite(arrival).astype(np.uint8), scar, src_transform=g.affine(), src_crs="EPSG:3857",
              dst_transform=tr, dst_crs="EPSG:3857", resampling=Resampling.nearest)
    d = np.nan_to_num(z["dnbr"], nan=-9)
    ok = z["valid"] & (scar > 0) & (np.nan_to_num(z["nbr_post"], nan=9) <= max(nbr_post_max, 0.1))
    from .sentinel2 import SEVERITY
    sev = np.zeros((sg["height"], sg["width"], 4), np.uint8)
    for lo, _, color in SEVERITY:
        sev[ok & (d >= max(lo, dnbr_min if lo == SEVERITY[0][0] else lo))] = color
    os.makedirs(out_dir, exist_ok=True)
    Image.fromarray(sev, "RGBA").save(os.path.join(out_dir, "severity.png"), optimize=True)


def refine_with_s2(arrival, g, npz_path, info_path, dnbr_min, nbr_post_max=1.0, reach_m=1500, min_patch_ha=5):
    """Final footprint = Sentinel-2 burn scar near VIIRS fire; timing = nearest VIIRS arrival.

    * scar: dNBR >= dnbr_min on the imagery grid, block-averaged onto the arrival
      grid (a cell is burned when >= 40% of it is), speckle removed;
    * only scar patches within `reach_m` of the VIIRS-derived burned area count
      (other changes in the scene - harvests, other fires - are ignored);
    * where Sentinel-2 had no clear view (clouds, water edges), VIIRS decides.
    """
    from rasterio.warp import reproject, Resampling
    z = np.load(npz_path)
    info = json.load(open(info_path))
    sg = info["grid"]
    from rasterio.transform import from_origin
    src_tr = from_origin(sg["x0"], sg["y1"], sg["res_mercator"], sg["res_mercator"])
    H, W = arrival.shape
    burned_src = (z["valid"] & (np.nan_to_num(z["dnbr"], nan=-1) >= dnbr_min)
                  & (np.nan_to_num(z["nbr_post"], nan=9) <= nbr_post_max)).astype(np.float32)
    valid_src = z["valid"].astype(np.float32)
    dn_src = np.where(z["valid"], z["dnbr"], np.nan).astype(np.float32)
    water_src = z["water"].astype(np.float32) if "water" in z else np.zeros_like(valid_src)
    frac = np.zeros((H, W), np.float32)
    vfrac = np.zeros((H, W), np.float32)
    wfrac = np.zeros((H, W), np.float32)
    dn = np.full((H, W), np.nan, np.float32)
    for src, dst, rs in ((burned_src, frac, Resampling.average), (valid_src, vfrac, Resampling.average),
                         (water_src, wfrac, Resampling.average), (dn_src, dn, Resampling.average)):
        reproject(src, dst, src_transform=src_tr, src_crs="EPSG:3857", dst_transform=g.affine(),
                  dst_crs="EPSG:3857", resampling=rs, src_nodata=np.nan if src is dn_src else None,
                  dst_nodata=np.nan if src is dn_src else None)
    viirs = np.isfinite(arrival)
    reach = ndimage.distance_transform_edt(~viirs) * g.ground_res <= reach_m
    scar = (frac >= 0.4) & (vfrac >= 0.5)
    scar = ndimage.binary_opening(scar, structure=disk(1))
    scar = ndimage.binary_closing(scar, structure=disk(1))
    lab, n = ndimage.label(scar)
    if n:
        keep = np.zeros(n + 1, bool)
        sizes = ndimage.sum(scar, lab, index=np.arange(1, n + 1)) * g.cell_area_ha
        touch = ndimage.maximum(reach.astype(np.uint8), lab, index=np.arange(1, n + 1))
        keep[1:] = (sizes >= min_patch_ha) & (touch > 0)
        scar = keep[lab]
    # small unburned islands inside the scar (< 2 ha) are clouds/shadows; fill them
    holes = ndimage.binary_fill_holes(scar) & ~scar
    lab, n = ndimage.label(holes)
    if n:
        sizes = ndimage.sum(holes, lab, index=np.arange(1, n + 1)) * g.cell_area_ha
        small = np.zeros(n + 1, bool)
        small[1:] = sizes < 2
        scar |= small[lab]
    no_view = (vfrac < 0.5) & (wfrac < 0.3)  # water counts as seen and unburned
    final = scar | (viirs & no_view)
    # timing: nearest VIIRS arrival
    _, (ri, ci) = ndimage.distance_transform_edt(~viirs, return_indices=True)
    out = np.full((H, W), np.inf)
    out[final] = arrival[ri[final], ci[final]]
    stats = {
        "scar_ha": round(float(scar.sum() * g.cell_area_ha), 1),
        "viirs_only_kept_ha": round(float((viirs & no_view & ~scar).sum() * g.cell_area_ha), 1),
        "viirs_dropped_ha": round(float((viirs & ~final).sum() * g.cell_area_ha), 1),
    }
    return out, dn, stats


def local_offset_hours(tzname, t):
    from zoneinfo import ZoneInfo
    off = dt.datetime.fromtimestamp(t, ZoneInfo(tzname)).utcoffset()
    return off.total_seconds() / 3600


def mask_to_lonlat(mask, g, simplify_m=60):
    shapes = features.shapes(mask.astype(np.uint8), mask=mask, transform=g.affine())
    min_area = (3 * g.ground_res * g.scale) ** 2  # drop specks smaller than 3x3 cells
    polys = [p for p in (shape(geom) for geom, val in shapes if val == 1) if p.area >= min_area]
    if not polys:
        return None
    from shapely.ops import unary_union
    u = unary_union(polys).simplify(simplify_m * g.scale, preserve_topology=True)
    u = u.buffer(0)
    ll = shp_transform(lambda x, y, z=None: TO_4326.transform(x, y), u)

    def rnd(o):
        if isinstance(o, (list, tuple)):
            return [rnd(v) for v in o]
        return round(o, 5)

    m = mapping(ll)
    return {"type": m["type"], "coordinates": rnd(m["coordinates"])}


def track_hotspots(det, passes, g, link_km=4.0, cluster_m=1200):
    """Cluster each overpass's fire pixels, then link clusters across overpasses."""
    tracks = []
    active = []  # indices into tracks
    for p in passes:
        idx = p["idx"]
        if len(idx) == 0:
            continue
        col, row = g.to_pixel(det["lon"][idx], det["lat"][idx])
        cell = cluster_m / g.ground_res
        key_c = np.floor(col / cell).astype(int)
        key_r = np.floor(row / cell).astype(int)
        # union-find over occupied coarse cells with 8-connectivity
        cells = {}
        for k, (a, b) in enumerate(zip(key_r, key_c)):
            cells.setdefault((a, b), []).append(k)
        parent = {c: c for c in cells}

        def find(c):
            while parent[c] != c:
                parent[c] = parent[parent[c]]
                c = parent[c]
            return c

        for (a, b) in cells:
            for da in (-1, 0, 1):
                for db in (-1, 0, 1):
                    nb = (a + da, b + db)
                    if nb in cells:
                        ra, rb = find((a, b)), find(nb)
                        if ra != rb:
                            parent[ra] = rb
        groups = {}
        for c, members in cells.items():
            groups.setdefault(find(c), []).extend(members)
        clusters = []
        for members in groups.values():
            ii = idx[np.array(members)]
            w = det["frp"][ii] + 1e-3
            clusters.append({
                "lon": float(np.average(det["lon"][ii], weights=w)),
                "lat": float(np.average(det["lat"][ii], weights=w)),
                "n": int(len(ii)),
                "frp": float(det["frp"][ii].sum()),
                "frp_max": float(det["frp"][ii].max()),
                "bt4_max": float(det["bt4"][ii].max()),
            })
        clusters.sort(key=lambda c: -c["frp"])
        used = set()
        still_active = []
        for c in clusters:
            best, bd = None, link_km
            for ti in active:
                if ti in used:
                    continue
                last = tracks[ti]["obs"][-1]
                if p["t"] - last["t"] > 36 * 3600:
                    continue
                dkm = haversine_km(c["lon"], c["lat"], last["lon"], last["lat"])
                if dkm < bd:
                    best, bd = ti, dkm
            ob = {"t": int(p["t"]), "lon": round(c["lon"], 5), "lat": round(c["lat"], 5), "n": c["n"],
                  "frp": round(c["frp"], 1), "frp_max": round(c["frp_max"], 1), "bt4_max": round(c["bt4_max"], 1),
                  "sat": p["sat"]}
            if best is None:
                tracks.append({"obs": [ob]})
                best = len(tracks) - 1
            else:
                tracks[best]["obs"].append(ob)
            used.add(best)
            still_active.append(best)
        active = [ti for ti in set(active) | set(still_active) if p["t"] - tracks[ti]["obs"][-1]["t"] <= 36 * 3600]

    for tr in tracks:
        tr["frp_total"] = round(sum(o["frp"] for o in tr["obs"]), 1)
        tr["n_total"] = sum(o["n"] for o in tr["obs"])
        tr["t_first"] = tr["obs"][0]["t"]
        tr["t_last"] = tr["obs"][-1]["t"]
    tracks = [tr for tr in tracks if len(tr["obs"]) >= 2 or tr["frp_total"] >= 50]
    tracks.sort(key=lambda tr: tr["t_first"])
    for k, tr in enumerate(tracks):
        tr["id"] = f"HS-{k + 1:03d}"
    return {"link_km": link_km, "cluster_m": cluster_m, "tracks": tracks}


def haversine_km(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(a))


def build_events(inc, det, pass_stats, days, area_final, t0, tz_off):
    ev = []

    def add(t, kind, title, detail="", prov="derived", **kw):
        ev.append({"t": int(t), "kind": kind, "title": title, "detail": detail, "prov": prov, **kw})

    ft = det["t"][0]
    first = det["sat"][0]
    add(ft, "detection", "First satellite detection", f"{first} VIIRS · {int((det['t'] == ft).sum())} fire pixels", "real")

    fire_passes = [p for p in pass_stats if p["n"]]
    if fire_passes:
        pk = max(fire_passes, key=lambda p: p["frp"])
        add(pk["t"], "frp", "Peak fire radiative power", f"{pk['frp']:,.0f} MW from {pk['n']} pixels ({pk['sat']})", "real",
            value=pk["frp"])
        # fastest growth between consecutive fire passes
        best, rate = None, 0
        for a, b in zip(fire_passes, fire_passes[1:]):
            dh = (b["t"] - a["t"]) / 3600
            if dh <= 0.5:
                continue
            r = (b["area_ha"] - a["area_ha"]) / dh
            if r > rate:
                best, rate = b, r
        if best:
            add(best["t"], "growth", "Fastest growth", f"{rate:,.0f} ha/h between overpasses", value=rate)
        # night runs: big growth on a night-time pass
        night = [(b, b["area_ha"] - a["area_ha"]) for a, b in zip(fire_passes, fire_passes[1:]) if b["day"] == 0]
        night = [x for x in night if x[1] > 0.08 * area_final]
        for b, gr in sorted(night, key=lambda x: -x[1])[:2]:
            add(b["t"], "night", "Night-time run", f"+{gr:,.0f} ha detected on a night overpass", value=gr)

    # area milestones
    hourly_area = [(p["t"], p["area_ha"]) for p in pass_stats]
    for frac in (0.25, 0.5, 0.9):
        target = frac * area_final
        for t, a in hourly_area:
            if a >= target:
                add(t, "milestone", f"{int(frac * 100)}% of final burned area", f"{a:,.0f} ha ({a / 0.404686:,.0f} acres)", value=a)
                break
    if days:
        big = max(days, key=lambda d: d["growth_ha"])
        add(big["t_end"] - 3600, "growth", f"Largest daily growth ({big['date']})",
            f"+{big['growth_ha']:,.0f} ha; front advanced {big['advance_km']:.1f} km", value=big["growth_ha"])
        # growth slows: first day after the peak with growth < 1% of the area
        peak_i = days.index(big)
        for d in days[peak_i + 1:]:
            if d["area_ha"] > 0 and d["growth_ha"] < 0.01 * d["area_ha"]:
                add(d["t_end"] - 12 * 3600, "slowing", "Growth slows below 1% a day", f"{d['date']}: +{d['growth_ha']:,.0f} ha")
                break

    for f in inc.get("reported", {}).get("facts", []):
        add(parse_time(f["t"]).timestamp(), "reported", f["text"], f["source"], "reported",
            **{k: v for k, v in f.items() if k in ("acres", "containment")})
    ev.sort(key=lambda e: e["t"])
    return ev


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("incident", choices=sorted(INCIDENTS))
    ap.add_argument("--raw", default=os.environ.get("WILDFIRE_RAW", "data/raw"))
    ap.add_argument("--out", default="public/data")
    ap.add_argument("--res", type=float, default=None)
    a = ap.parse_args()
    res = a.res or (100 if INCIDENTS[a.incident]["bbox"] and (INCIDENTS[a.incident]["bbox"][2] - INCIDENTS[a.incident]["bbox"][0]) < 0.5 else 120)
    build(a.incident, a.raw, os.path.join(a.out, a.incident), res_m=res)
