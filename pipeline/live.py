"""Turn the global scan into live incident packages for the fires burning now.

Reads the output of pipeline/scan_global.py, picks the most significant active
fire complexes with geographic diversity, describes each one automatically
(name from the Natural Earth gazetteer, time zone, nearest airport as air base,
Sentinel-2 windows) and builds the same package as a curated incident:

  detections + overpasses   from the scan's own pixels (no second download)
  arrival time, perimeters,
  hot spots, events         pipeline/build_incident.py (VIIRS footprints: the
                            burn scar is not final while the fire is burning)
  imagery                   Sentinel-2 composites: before the fire, and the latest
  weather                   Open-Meteo hourly model data (station archives lag)

Packages of fires that dropped out of the selection are removed.

    python -m pipeline.scan_global --days 8 && python -m pipeline.live --max 8
"""

import argparse
import csv
import datetime as dt
import json
import math
import os
import re
import shutil
import sys
import unicodedata

import numpy as np
import requests

from .incidents import INCIDENTS, SATELLITES

PLACES_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson"
ISD_HISTORY = "https://noaa-isd-pds.s3.amazonaws.com/isd-history.csv"
SAT_NAMES = list(SATELLITES)


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def km(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(a))


def cached(url, path):
    if not os.path.exists(path):
        r = requests.get(url, timeout=120)
        r.raise_for_status()
        with open(path, "wb") as f:
            f.write(r.content)
    return path


class Gazetteer:
    def __init__(self, raw):
        g = json.load(open(cached(PLACES_URL, os.path.join(raw, "ne_places.geojson"))))
        self.places = [
            (f["geometry"]["coordinates"][0], f["geometry"]["coordinates"][1], f["properties"].get("name") or "",
             f["properties"].get("adm1name") or "", f["properties"].get("adm0name") or "", f["properties"].get("pop_max") or 0)
            for f in g["features"]
        ]
        self.lon = np.array([p[0] for p in self.places])
        self.lat = np.array([p[1] for p in self.places])
        # Natural Earth uses -99 for unknown populations
        self.pop = np.clip(np.nan_to_num(np.array([p[5] for p in self.places], float)), 0, None)

    def near(self, lon, lat):
        """Nearest notable place: distance discounted for bigger towns, so a fire is named after a place people know."""
        d = np.hypot((self.lon - lon) * math.cos(math.radians(lat)), self.lat - lat) * 111
        score = d / (1 + np.log10(1 + self.pop) / 3)
        i = int(np.argmin(score))
        p = self.places[i]
        return {"name": p[2], "adm1": p[3], "country": p[4], "km": round(float(d[i]), 1), "lonlat": [p[0], p[1]]}


class Airports:
    def __init__(self, raw):
        path = cached(ISD_HISTORY, os.path.join(raw, "isd-history.csv"))
        self.rows = []
        for r in csv.DictReader(open(path)):
            if not r["ICAO"].strip() or r["END"] < "20230101":
                continue
            try:
                self.rows.append((float(r["LON"]), float(r["LAT"]), r["STATION NAME"].title(), r["ICAO"]))
            except ValueError:
                continue

    def near(self, lon, lat, max_km=400):
        best, bd = None, max_km
        for r in self.rows:
            if abs(r[1] - lat) > 4:
                continue
            d = km(lon, lat, r[0], r[1])
            if d < bd:
                best, bd = r, d
        return best


def select(cx, k, min_km=350, per_country=3, gaz=None):
    """Most significant active complexes: burned extent × compactness × density, spread over the globe."""
    cand = []
    for c in cx:
        if c["recent_24h"] < 15 or c["pixels"] < 120:
            continue
        w, s, e, n = c["bbox"]
        bb = max(1.0, (e - w) * 111 * math.cos(math.radians((s + n) / 2)) * (n - s) * 111)
        fill = min(1.0, c["area_km2_est"] / bb)
        dens = c["pixels"] / max(1, c["cells"])
        c["rank"] = c["area_km2_est"] * fill * dens * (1 + min(1.0, c["recent_24h"] / c["pixels"]))
        cand.append(c)
    cand.sort(key=lambda c: -c["rank"])
    chosen, per = [], {}
    for c in cand:
        if any(km(*c["center"], *o["center"]) < min_km for o in chosen):
            continue
        place = gaz.near(*c["center"]) if gaz else {"country": "?"}
        if per.get(place["country"], 0) >= per_country:
            continue
        per[place["country"]] = per.get(place["country"], 0) + 1
        c["place"] = place
        chosen.append(c)
        if len(chosen) >= k:
            break
    return chosen


def densest_window(lon, lat, bbox, size=(0.9, 0.8)):
    w, s, e, n = bbox
    bw, bh = size
    if e - w <= bw and n - s <= bh:
        return bbox
    best, score = None, -1
    xs = np.arange(w + min(bw, e - w) / 2, max(w + min(bw, e - w) / 2, e - min(bw, e - w) / 2) + 1e-9, 0.05)
    ys = np.arange(s + min(bh, n - s) / 2, max(s + min(bh, n - s) / 2, n - min(bh, n - s) / 2) + 1e-9, 0.05)
    for cx in xs:
        for cy in ys:
            sc = int(((np.abs(lon - cx) <= bw / 2) & (np.abs(lat - cy) <= bh / 2)).sum())
            if sc > score:
                best, score = (cx, cy), sc
    cx, cy = best
    return [cx - min(bw, e - w) / 2, cy - min(bh, n - s) / 2, cx + min(bw, e - w) / 2, cy + min(bh, n - s) / 2]


def fleet_for(country):
    if country in ("United States of America", "United States", "Canada"):
        return "us"
    if country == "Brazil":
        return "br"
    return "intl"


def describe(c, px, t_end, gaz, airports, tzf):
    sel = px["comp"] == c["root"]
    lon, lat = px["lon"][sel], px["lat"][sel]
    pad = 0.06
    bbox = densest_window(lon, lat, [c["bbox"][0] - pad, c["bbox"][1] - pad, c["bbox"][2] + pad, c["bbox"][3] + pad])
    bbox = [round(float(v), 3) for v in bbox]
    center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
    place = gaz.near(*center)
    inside = sel & (px["lon"] >= bbox[0]) & (px["lon"] <= bbox[2]) & (px["lat"] >= bbox[1]) & (px["lat"] <= bbox[3])
    first = float(px["t"][inside].min()) if inside.any() else c["first"]
    start = dt.datetime.fromtimestamp(first - 6 * 3600, dt.timezone.utc).replace(minute=0, second=0)
    tz = tzf.timezone_at(lng=center[0], lat=center[1]) or "UTC"
    ap = airports.near(*center)
    base = {"name": f"{ap[2]} ({ap[3]})" if ap else "Forward air base (sim)", "lonlat": [ap[0], ap[1]] if ap else [bbox[0] - 0.1, bbox[1] - 0.1]}
    # staging just outside the burning area, on the side of the named town
    icp_ll = [min(max(place["lonlat"][0], bbox[0] - 0.02), bbox[2] + 0.02), min(max(place["lonlat"][1], bbox[1] - 0.02), bbox[3] + 0.02)]
    pid = f"live-{slug(place['country'])[:20]}-{slug(place['name'])[:24]}"
    near = f"{place['km']:.0f} km from {place['name']}" if place["km"] > 3 else place["name"]
    region = ", ".join(x for x in (place["adm1"], place["country"]) if x)
    return pid, {
        "name": f"Fire near {place['name']}",
        "region": f"{region} · {near}",
        "country": place["country"],
        "bbox": bbox,
        "start": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end": t_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timezone": tz,
        "origin": None,
        "isd_station": None,
        "weather": "open-meteo",
        "s2_pre": [(start - dt.timedelta(days=50)).date().isoformat(), (start - dt.timedelta(days=1)).date().isoformat()],
        "s2_post": [(t_end - dt.timedelta(days=21)).date().isoformat(), t_end.date().isoformat()],
        "base": base,
        "icp": {"name": "Staging area (sim)", "lonlat": [round(icp_ll[0], 4), round(icp_ll[1], 4)]},
        "reported": {
            "sources": [
                {"label": "NASA FIRMS · live map of this area", "url": f"https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@{center[0]:.2f},{center[1]:.2f},9.0z"},
            ],
        },
        "fleet": fleet_for(place["country"]),
        "live": True,
        "rank": round(c["rank"], 1),
    }


def write_raw(pid, inc, px, raw):
    w, s, e, n = inc["bbox"]
    t0 = dt.datetime.fromisoformat(inc["start"].replace("Z", "+00:00")).timestamp() - 6 * 3600
    sel = (px["lon"] >= w) & (px["lon"] <= e) & (px["lat"] >= s) & (px["lat"] <= n) & (px["t"] >= t0)
    d = os.path.join(raw, pid)
    os.makedirs(d, exist_ok=True)
    idx = np.nonzero(sel)[0]
    with open(os.path.join(d, "detections.csv"), "w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["time", "lat", "lon", "satellite", "frp", "confidence", "fire_mask", "day", "pixel_area", "bt4", "bt11", "sat_zenith", "persistent", "granule"])
        for i in idx:
            t = dt.datetime.fromtimestamp(float(px["t"][i]), dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            wr.writerow([t, round(float(px["lat"][i]), 5), round(float(px["lon"][i]), 5), SAT_NAMES[int(px["sat"][i])], round(float(px["frp"][i]), 2),
                         -99, int(px["mask"][i]), int(px["day"][i]), 0, round(float(px["bt4"][i]), 2), 0, round(float(px["zen"][i]), 1), 0, ""])
    # overpasses that saw fire in the box (the scan does not keep empty looks)
    with open(os.path.join(d, "granules.csv"), "w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["satellite", "granule", "start"])
        seen = set()
        for i in idx:
            key = (int(px["sat"][i]), int(px["t"][i] // 300))
            if key in seen:
                continue
            seen.add(key)
            wr.writerow([SAT_NAMES[key[0]], "", dt.datetime.fromtimestamp(float(px["t"][i]), dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")])
    return int(sel.sum())


def thumbnail(out_dir):
    from PIL import Image
    post = os.path.join(out_dir, "s2_post.jpg")
    arr = os.path.join(out_dir, "arrival.png")
    if not os.path.exists(arr):
        return
    a = np.array(Image.open(arr))
    burned = ((a[..., 0].astype(int) << 8) | a[..., 1]) != 65535
    if os.path.exists(post):
        img = Image.open(post).convert("RGB")
    else:
        img = Image.new("RGB", (a.shape[1], a.shape[0]), (60, 52, 44))
    mask = Image.fromarray((burned * 190).astype(np.uint8)).resize(img.size)
    red = Image.new("RGB", img.size, (232, 70, 20))
    img = Image.composite(red, img, mask)
    h = int(img.height * 480 / img.width)
    img.resize((480, h)).save(os.path.join(out_dir, "thumb.jpg"), quality=80)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=8)
    ap.add_argument("--raw", default=os.environ.get("WILDFIRE_RAW", "data/raw"))
    ap.add_argument("--out", default="public/data")
    ap.add_argument("--no-s2", action="store_true", help="skip Sentinel-2 imagery (faster)")
    a = ap.parse_args()
    from timezonefinder import TimezoneFinder

    from . import build_incident, sentinel2, weather

    live_raw = os.path.join(a.raw, "live")
    meta = json.load(open(os.path.join(live_raw, "complexes.json")))
    z = np.load(os.path.join(live_raw, "pixels.npz"))
    px = {k: z[k] for k in z.files}
    t_end = dt.datetime.fromisoformat(meta["t_end"])
    gaz = Gazetteer(a.raw)
    airports = Airports(a.raw)
    tzf = TimezoneFinder()
    chosen = select(meta["complexes"], a.max, gaz=gaz)
    built = []
    for c in chosen:
        pid, inc = describe(c, px, t_end, gaz, airports, tzf)
        k = 2
        while pid in built:  # two fires near the same town
            pid = f"{pid.rsplit('-', 1)[0] if k > 2 else pid}-{k}"
            k += 1
        if pid in INCIDENTS and not INCIDENTS[pid].get("live"):
            continue
        INCIDENTS[pid] = inc
        n = write_raw(pid, inc, px, a.raw)
        print(f"{pid}: {inc['name']} · {inc['region']} · {n} pixels · bbox {inc['bbox']}", file=sys.stderr)
        out_dir = os.path.join(a.out, pid)
        span_km = max((inc["bbox"][2] - inc["bbox"][0]) * 111 * math.cos(math.radians(inc["bbox"][1])), (inc["bbox"][3] - inc["bbox"][1]) * 111)
        res = int(max(60, min(150, span_km * 1000 / 900)))
        try:
            if not a.no_s2:
                try:
                    sentinel2.run(pid, a.raw, a.out, res_m=max(30, res // 2))
                except Exception as exc:  # imagery is a nice-to-have for a live fire
                    print(f"  sentinel-2 skipped: {exc}", file=sys.stderr)
                    s2 = os.path.join(a.raw, pid, "s2.json")
                    if os.path.exists(s2):
                        os.remove(s2)
            build_incident.build(pid, a.raw, out_dir, res_m=res, use_s2=False)
            if os.path.exists(os.path.join(out_dir, "severity.png")):
                os.remove(os.path.join(out_dir, "severity.png"))  # dNBR of a fire still burning is not a severity map
            try:
                weather.run_openmeteo(pid, a.out)
            except Exception as exc:
                print(f"  weather skipped: {exc}", file=sys.stderr)
            thumbnail(out_dir)
            m = json.load(open(os.path.join(out_dir, "incident.json")))
            m["live"] = {"updated": t_end.strftime("%Y-%m-%dT%H:%MZ"), "rank": inc["rank"], "active_24h": c["recent_24h"]}
            with open(os.path.join(out_dir, "incident.json"), "w") as f:
                json.dump(m, f, separators=(",", ":"))
            built.append(pid)
        except Exception as exc:
            print(f"  {pid} failed: {exc}", file=sys.stderr)
            shutil.rmtree(out_dir, ignore_errors=True)
    # drop live packages that are no longer selected
    for d in os.listdir(a.out):
        if d.startswith("live-") and d not in built:
            shutil.rmtree(os.path.join(a.out, d), ignore_errors=True)
    print(f"built {len(built)} live incidents", file=sys.stderr)


if __name__ == "__main__":
    main()
