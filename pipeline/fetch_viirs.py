"""Fetch VIIRS 375 m active-fire detections for an incident from NOAA's open archive.

Source: NOAA Enterprise Fire product (EFIRE, VIIRS I-band, v1r3) for S-NPP,
NOAA-20 and NOAA-21, published on the NOAA Open Data Dissemination buckets on
AWS (no account needed). Each granule covers ~85 s of orbit. To avoid pulling
~3,000 granules a day we:

1. list the granules of each day and keep the ones whose start time falls in
   the daytime (~13:30 local solar) or night-time (~01:30) overpass windows
   for the incident's longitude;
2. range-read only the first 32 KB of each candidate, which holds the
   granule's `geospatial_bounds` polygon, and keep those intersecting the bbox;
3. download those granules and keep the fire pixels inside the bbox.

Output: <raw>/<incident>/detections.csv (one row per fire pixel).

    python -m pipeline.fetch_viirs park-2024 [--raw DIR]
"""

import argparse
import concurrent.futures as cf
import csv
import datetime as dt
import io
import os
import re
import sys
import time

import h5py
import numpy as np
import requests
from shapely import wkt
from shapely.geometry import box

from .incidents import INCIDENTS, SATELLITES

PRODUCT = "VIIRS_EFIRE_VIIRSI_EDR"
SESSION = requests.Session()
SESSION.mount("https://", requests.adapters.HTTPAdapter(pool_connections=64, pool_maxsize=64))

FIELDS = [
    "time", "lat", "lon", "satellite", "frp", "confidence", "fire_mask", "day",
    "pixel_area", "bt4", "bt11", "sat_zenith", "persistent", "granule",
]


def get(url, **kw):
    for attempt in range(5):
        try:
            r = SESSION.get(url, timeout=60, **kw)
            if r.status_code in (200, 206):
                return r
            if r.status_code == 404:
                return None
        except requests.RequestException:
            pass
        time.sleep(2 ** attempt)
    raise RuntimeError(f"failed: {url}")


def list_day(bucket, day):
    keys, token = [], None
    prefix = f"{PRODUCT}/{day:%Y/%m/%d}/"
    while True:
        url = f"https://{bucket}.s3.amazonaws.com/?list-type=2&prefix={prefix}"
        if token:
            url += "&continuation-token=" + requests.utils.quote(token, safe="")
        r = get(url)
        if r is None:
            return keys
        keys += re.findall(r"<Key>([^<]+)</Key>", r.text)
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", r.text)
        if not m:
            return keys
        token = m.group(1)


def granule_start(key):
    m = re.search(r"_s(\d{14})", key)
    return dt.datetime.strptime(m.group(1)[:14], "%Y%m%d%H%M%S").replace(tzinfo=dt.timezone.utc)


def in_overpass_window(t, lon, half_width_h=2.0):
    """Polar orbiters cross at ~13:30 and ~01:30 local solar time."""
    solar = (t.hour + t.minute / 60 + lon / 15.0) % 24
    return min(abs(solar - 13.5), 24 - abs(solar - 13.5)) <= half_width_h or \
        min(abs(solar - 1.5), 24 - abs(solar - 1.5)) <= half_width_h


def granule_bounds(bucket, key):
    r = get(f"https://{bucket}.s3.amazonaws.com/{key}", headers={"Range": "bytes=0-32767"})
    if r is None:
        return None
    m = re.search(rb"POLYGON\(\([-0-9., ]+\)\)", r.content)
    if not m:
        return None
    try:
        return wkt.loads(m.group(0).decode())
    except Exception:
        return None


def download(bucket, key):
    r = get(f"https://{bucket}.s3.amazonaws.com/{key}")
    return None if r is None else r.content


def read_granule(content, key, bbox, sat):
    """Parse one granule with h5py (netCDF4 crashes on a few truncated archive files)."""
    if content is None:
        return []
    try:
        f = h5py.File(io.BytesIO(content), "r")
        n = f["FP_Latitude"].shape[0]
    except Exception as exc:
        print(f"skip {key}: {exc}", file=sys.stderr)
        return []
    if n == 0:
        return []
    v = lambda name: np.asarray(f[name][:])
    lat, lon = v("FP_Latitude"), v("FP_Longitude")
    w, s, e, nn = bbox
    sel = (lon >= w) & (lon <= e) & (lat >= s) & (lat <= nn)
    if not sel.any():
        return []
    attr = lambda k: f.attrs[k].decode() if isinstance(f.attrs[k], bytes) else str(f.attrs[k])
    t0 = dt.datetime.strptime(attr("time_coverage_start"), "%Y-%m-%dT%H:%M:%SZ")
    t1 = dt.datetime.strptime(attr("time_coverage_end"), "%Y-%m-%dT%H:%M:%SZ")
    nlines = f["y"].shape[0]
    frac = v("FP_Line") / max(nlines - 1, 1)
    times = [t0 + (t1 - t0) * float(x) for x in frac]
    cols = {
        "frp": v("FP_FireRadiativePower"), "confidence": v("FP_Confidence"), "fire_mask": v("FP_FireMask"),
        "day": v("FP_Day"), "pixel_area": v("FP_PixelArea"), "bt4": v("FP_BT4um"), "bt11": v("FP_BT11um"),
        "sat_zenith": v("FP_SatZenithAngle"), "persistent": v("FP_PersistentAnomalyCategory"),
    }
    rows = []
    for i in np.nonzero(sel)[0]:
        rows.append({
            "time": times[i].strftime("%Y-%m-%dT%H:%M:%SZ"), "lat": round(float(lat[i]), 5), "lon": round(float(lon[i]), 5),
            "satellite": sat, "frp": round(float(cols["frp"][i]), 2), "confidence": int(cols["confidence"][i]),
            "fire_mask": int(cols["fire_mask"][i]), "day": int(cols["day"][i]),
            "pixel_area": round(float(cols["pixel_area"][i]), 4), "bt4": round(float(cols["bt4"][i]), 2),
            "bt11": round(float(cols["bt11"][i]), 2), "sat_zenith": round(float(cols["sat_zenith"][i]), 1),
            "persistent": int(cols["persistent"][i]), "granule": key.rsplit("/", 1)[-1],
        })
    f.close()
    return rows


def fetch(incident_id, raw_dir, workers=48):
    inc = INCIDENTS[incident_id]
    bbox = inc["bbox"] or inc["search_bbox"]
    lon_c = (bbox[0] + bbox[2]) / 2
    region = box(*bbox)
    t_start = dt.datetime.fromisoformat(inc["start"].replace("Z", "+00:00")) - dt.timedelta(hours=12)
    t_end = dt.datetime.fromisoformat(inc["end"].replace("Z", "+00:00"))
    out_dir = os.path.join(raw_dir, incident_id)
    os.makedirs(out_dir, exist_ok=True)

    days = []
    d = t_start.date()
    while d <= t_end.date():
        days.append(d)
        d += dt.timedelta(days=1)

    candidates = []
    with cf.ThreadPoolExecutor(workers) as ex:
        listings = {ex.submit(list_day, bucket, day): (sat, bucket) for sat, bucket in SATELLITES.items() for day in days}
        for fut in cf.as_completed(listings):
            sat, bucket = listings[fut]
            for key in fut.result():
                t = granule_start(key)
                if t_start <= t <= t_end and in_overpass_window(t, lon_c):
                    candidates.append((sat, bucket, key))
    print(f"{incident_id}: {len(candidates)} candidate granules", file=sys.stderr)

    hits = []
    with cf.ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(granule_bounds, b, k): (s, b, k) for s, b, k in candidates}
        for fut in cf.as_completed(futs):
            poly = fut.result()
            if poly is not None and poly.is_valid and poly.intersects(region):
                hits.append(futs[fut])
    print(f"{incident_id}: {len(hits)} granules intersect the bbox", file=sys.stderr)

    rows, passes = [], []
    with cf.ThreadPoolExecutor(min(workers, 24)) as ex:
        futs = {ex.submit(download, b, k): (s, b, k) for s, b, k in hits}
        for fut in cf.as_completed(futs):
            s, b, k = futs[fut]
            rows += read_granule(fut.result(), k, bbox, s)
            passes.append({"satellite": s, "granule": k.rsplit("/", 1)[-1], "start": granule_start(k).strftime("%Y-%m-%dT%H:%M:%SZ")})
    rows.sort(key=lambda r: r["time"])
    passes.sort(key=lambda p: p["start"])

    with open(os.path.join(out_dir, "detections.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, FIELDS)
        w.writeheader()
        w.writerows(rows)
    with open(os.path.join(out_dir, "granules.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, ["satellite", "granule", "start"])
        w.writeheader()
        w.writerows(passes)
    print(f"{incident_id}: {len(rows)} detections from {len(passes)} granules", file=sys.stderr)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("incident", choices=sorted(INCIDENTS))
    ap.add_argument("--raw", default=os.environ.get("WILDFIRE_RAW", "data/raw"))
    a = ap.parse_args()
    fetch(a.incident, a.raw)
