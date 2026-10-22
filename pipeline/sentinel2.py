"""Sentinel-2 L2A pre-/post-fire composites and burn severity (dNBR).

Source: Sentinel-2 L2A Cloud-Optimized GeoTIFFs on AWS (Element 84 /
`sentinel-cogs`, open). For each period (before / after the fire) we take
the scenes of every MGRS tile touching the bbox, least cloudy first, and
fill each grid pixel from the first scene whose scene classification (SCL)
says the pixel is clear land or water. Bands are read from COG overviews and
reprojected straight onto the incident's Web Mercator imagery grid.

Outputs:
  public/data/<id>/s2_pre.jpg, s2_post.jpg   true colour (TCI)
  public/data/<id>/severity.png              dNBR classes (USGS thresholds)
  <raw>/<id>/s2.npz                          nbr_pre, nbr_post, dnbr, valid (for build_incident)

    python -m pipeline.sentinel2 park-2024
"""

import argparse
import concurrent.futures as cf
import datetime as dt
import json
import os
import re

import mgrs
import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT

from .grid import Grid
from .incidents import INCIDENTS

BUCKET = "https://sentinel-cogs.s3.us-west-2.amazonaws.com"
PREFIX = "sentinel-s2-l2a-cogs"
CLEAR = {2, 4, 5, 6, 7, 11}  # dark/terrain shadow, vegetation, bare, water, unclassified, snow
SEVERITY = [  # (dNBR lower bound, label, RGBA)
    (0.10, "Low", (255, 214, 102, 170)),
    (0.27, "Moderate-low", (252, 141, 60, 200)),
    (0.44, "Moderate-high", (215, 48, 31, 220)),
    (0.66, "High", (110, 15, 40, 235)),
]

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")
os.environ.setdefault("VSI_CACHE", "TRUE")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
if os.path.exists("/root/.ccr/ca-bundle.crt"):
    os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")


def tiles_for_bbox(bbox, step=0.04):
    m = mgrs.MGRS()
    w, s, e, n = bbox
    out = set()
    for lat in np.arange(s, n + step, step):
        for lon in np.arange(w, e + step, step):
            code = m.toMGRS(min(lat, n), min(lon, e), MGRSPrecision=0)
            zone, band, sq = code[:-3], code[-3], code[-2:]
            out.add((zone, band, sq))
            # tiles overlap latitude bands: also try the neighbouring band letters
            for b in ("CDEFGHJKLMNPQRSTUVWX"[max(0, "CDEFGHJKLMNPQRSTUVWX".index(band) - 1)],
                      "CDEFGHJKLMNPQRSTUVWX"[min(19, "CDEFGHJKLMNPQRSTUVWX".index(band) + 1)]):
                out.add((zone, b, sq))
    return sorted(out)


def list_scenes(tile, d0, d1):
    import requests
    zone, band, sq = tile
    scenes = []
    months = sorted({(d.year, d.month) for d in (d0 + dt.timedelta(days=k) for k in range((d1 - d0).days + 1))})
    for y, mth in months:
        url = f"{BUCKET}/?list-type=2&delimiter=/&prefix={PREFIX}/{int(zone)}/{band}/{sq}/{y}/{mth}/"
        txt = requests.get(url, timeout=60).text
        for p in re.findall(r"<Prefix>([^<]+)</Prefix>", txt):
            m = re.search(r"_(\d{8})_\d+_L2A/$", p)
            if not m:
                continue
            d = dt.datetime.strptime(m.group(1), "%Y%m%d").date()
            if d0 <= d <= d1:
                scenes.append(p)
    items = []
    for p in scenes:
        name = p.rstrip("/").rsplit("/", 1)[-1]
        try:
            it = requests.get(f"{BUCKET}/{p}{name}.json", timeout=60).json()
        except Exception:
            continue
        props = it["properties"]
        if not all(k in it.get("assets", {}) for k in ("visual", "nir", "swir22", "scl")):
            continue
        items.append({
            "id": it["id"], "date": props["datetime"][:10], "cloud": props.get("eo:cloud_cover", 100),
            "nodata": props.get("s2:nodata_pixel_percentage", 0), "bbox": it["bbox"],
            "assets": {k: it["assets"][k]["href"] for k in ("visual", "nir", "swir22", "scl")},
        })
    return items


def read_on_grid(href, g, ov, resampling):
    with rasterio.open(href, overview_level=ov) as src:
        with WarpedVRT(src, crs="EPSG:3857", transform=g.affine(), width=g.width, height=g.height,
                       resampling=resampling, nodata=0) as vrt:
            return vrt.read()


def scene_arrays(item, g):
    # COG overviews halve the resolution each level: 10 m bands -> 20 m (0), 40 m (1);
    # 20 m bands -> 40 m (0). Pick the level closest to the grid resolution.
    fine = g.ground_res < 35
    ov10, ov20 = (0, None) if fine else (1, 0)
    vis = read_on_grid("/vsicurl/" + item["assets"]["visual"], g, ov10, Resampling.bilinear)
    nir = read_on_grid("/vsicurl/" + item["assets"]["nir"], g, ov10, Resampling.bilinear)[0].astype(np.float32)
    sw = read_on_grid("/vsicurl/" + item["assets"]["swir22"], g, ov20, Resampling.bilinear)[0].astype(np.float32)
    scl = read_on_grid("/vsicurl/" + item["assets"]["scl"], g, ov20, Resampling.nearest)[0]
    return vis, nir, sw, scl


def composite(items, g, max_scenes=14):
    H, W = g.height, g.width
    rgb = np.zeros((3, H, W), np.uint8)
    nbr = np.full((H, W), np.nan, np.float32)
    filled = np.zeros((H, W), bool)
    water = np.zeros((H, W), bool)
    fallback = None
    used = []
    items = sorted(items, key=lambda it: (it["cloud"] + it["nodata"] * 0.5))
    with cf.ThreadPoolExecutor(4) as ex:
        futs = [ex.submit(scene_arrays, it, g) for it in items[:max_scenes * 3]]
        for it, fut in zip(items[:max_scenes * 3], futs):
            try:
                vis, nir, sw, scl = fut.result()
            except Exception as exc:
                print("  skip", it["id"], exc)
                continue
            if fallback is None:
                fallback = vis.copy()
            else:
                hole = (fallback.max(axis=0) == 0) & (vis.max(axis=0) > 0)
                fallback[:, hole] = vis[:, hole]
            ok = np.isin(scl, list(CLEAR)) & (nir > 0) & (sw > 0) & ~filled
            water |= ok & (scl == 6)
            if ok.sum() < 0.002 * H * W:
                continue
            rgb[:, ok] = vis[:, ok]
            nbr[ok] = (nir[ok] - sw[ok]) / (nir[ok] + sw[ok])
            filled |= ok
            used.append({"id": it["id"], "date": it["date"], "cloud": round(it["cloud"], 1), "pixels": int(ok.sum())})
            if filled.mean() > 0.995 or len(used) >= max_scenes:
                break
    # pixels never clear: fall back to the least cloudy scene so the picture has no holes
    if fallback is not None:
        rgb[:, ~filled] = fallback[:, ~filled]
    return rgb, nbr, filled, water, used


def enhance(rgb):
    x = rgb.astype(np.float32) / 255.0
    lo, hi = np.percentile(x[x > 0], 1) if (x > 0).any() else 0, np.percentile(x, 99.5)
    x = np.clip((x - lo) / max(hi - lo, 1e-3), 0, 1) ** 0.9
    return (x * 255).astype(np.uint8)


def run(incident_id, raw_dir, out_dir, res_m=None):
    inc = INCIDENTS[incident_id]
    meta_path = os.path.join(out_dir, incident_id, "incident.json")
    bbox = inc["bbox"] or json.load(open(meta_path))["bbox"]
    span = max(bbox[2] - bbox[0], bbox[3] - bbox[1])
    res_m = res_m or (20 if span < 0.4 else 40)
    g = Grid(bbox, res_m)
    print(f"{incident_id}: imagery grid {g.width}x{g.height} @ {res_m} m")
    tiles = tiles_for_bbox(bbox)
    periods = {}
    for key in ("s2_pre", "s2_post"):
        d0, d1 = (dt.date.fromisoformat(x) for x in inc[key])
        items = []
        with cf.ThreadPoolExecutor(8) as ex:
            for res in ex.map(lambda t: list_scenes(t, d0, d1), tiles):
                items += res
        # keep scenes whose footprint touches the bbox
        items = [it for it in items if not (it["bbox"][2] < bbox[0] or it["bbox"][0] > bbox[2] or it["bbox"][3] < bbox[1] or it["bbox"][1] > bbox[3])]
        print(f"  {key}: {len(items)} scenes on {len({i['id'].split('_')[1] for i in items})} tiles")
        rgb, nbr, filled, water, used = composite(items, g)
        print(f"  {key}: {filled.mean() * 100:.1f}% clear from {len(used)} scenes")
        periods[key] = (rgb, nbr, filled, used, water)

    os.makedirs(os.path.join(out_dir, incident_id), exist_ok=True)
    for key, name in (("s2_pre", "s2_pre.jpg"), ("s2_post", "s2_post.jpg")):
        rgb = enhance(periods[key][0])
        Image.fromarray(np.moveaxis(rgb, 0, -1)).save(os.path.join(out_dir, incident_id, name), quality=82, optimize=True, progressive=True)

    nbr_pre, nbr_post = periods["s2_pre"][1], periods["s2_post"][1]
    water = periods["s2_pre"][4] | periods["s2_post"][4]
    valid = np.isfinite(nbr_pre) & np.isfinite(nbr_post) & ~water
    dnbr = np.where(valid, nbr_pre - nbr_post, np.nan)
    sev = np.zeros((g.height, g.width, 4), np.uint8)
    for lo, _, color in SEVERITY:
        sev[valid & (dnbr >= lo)] = color
    Image.fromarray(sev, "RGBA").save(os.path.join(out_dir, incident_id, "severity.png"), optimize=True)
    np.savez_compressed(os.path.join(raw_dir, incident_id, "s2.npz"), dnbr=dnbr.astype(np.float32), valid=valid, water=water,
                        nbr_pre=nbr_pre, nbr_post=nbr_post)
    info = {
        "grid": g.describe(),
        "pre": {"window": inc["s2_pre"], "scenes": periods["s2_pre"][3], "clear_pct": round(float(periods["s2_pre"][2].mean() * 100), 1)},
        "post": {"window": inc["s2_post"], "scenes": periods["s2_post"][3], "clear_pct": round(float(periods["s2_post"][2].mean() * 100), 1)},
        "severity_classes": [{"min_dnbr": lo, "label": lab, "color": list(c)} for lo, lab, c in SEVERITY],
    }
    with open(os.path.join(raw_dir, incident_id, "s2.json"), "w") as f:
        json.dump(info, f)
    print(f"  dNBR>=0.1: {(valid & (dnbr >= 0.1)).sum() * g.cell_area_ha:,.0f} ha")
    return info


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("incident", choices=sorted(INCIDENTS))
    ap.add_argument("--raw", default=os.environ.get("WILDFIRE_RAW", "data/raw"))
    ap.add_argument("--out", default="public/data")
    ap.add_argument("--res", type=float)
    a = ap.parse_args()
    run(a.incident, a.raw, a.out, a.res)
