"""Scan every VIIRS fire pixel on Earth for the last few days and find the fire complexes.

Every EFIRE granule of S-NPP, NOAA-20 and NOAA-21 in the window is opened over
HTTP range requests (pipeline/httpfile.py), so only the small fire-pixel arrays
are transferred (~30% of each file). Pixels are binned on a ~2 km grid and
8-connected cells form a fire complex. Complexes are ranked by burned extent
and recent activity.

Outputs (in --out, default public/data/live):
  world.json      all fire pixels of the last 48 h binned to 0.25°, and every
                  complex with its stats (the app's world view)
  <raw>/live/pixels.npz, complexes.json   inputs for pipeline/live.py

    python -m pipeline.scan_global --days 4
"""

import argparse
import concurrent.futures as cf
import datetime as dt
import json
import multiprocessing as mp
import os
import sys
import time

import numpy as np

from .incidents import SATELLITES

PRODUCT = "VIIRS_EFIRE_VIIRSI_EDR"
FIELDS = ["FP_Latitude", "FP_Longitude", "FP_FireRadiativePower", "FP_FireMask", "FP_Day", "FP_Line",
          "FP_PersistentAnomalyCategory", "FP_BT4um", "FP_SatZenithAngle"]


def _read(task):
    """Worker: fire pixels of one granule. Runs in a separate process (h5py serialises I/O)."""
    import h5py
    from .httpfile import HttpFile

    sat, bucket, key, size = task
    url = f"https://{bucket}.s3.amazonaws.com/{key}"
    for attempt in range(3):
        try:
            f = HttpFile(url, block=65536, size=size)
            h = h5py.File(f, "r")
            n = h["FP_Latitude"].shape[0]
            if n == 0:
                return sat, key, None
            a = {k: np.asarray(h[k][:]) for k in FIELDS}
            t0 = dt.datetime.strptime(h.attrs["time_coverage_start"].decode() if isinstance(h.attrs["time_coverage_start"], bytes) else str(h.attrs["time_coverage_start"]), "%Y-%m-%dT%H:%M:%SZ")
            t1 = dt.datetime.strptime(h.attrs["time_coverage_end"].decode() if isinstance(h.attrs["time_coverage_end"], bytes) else str(h.attrs["time_coverage_end"]), "%Y-%m-%dT%H:%M:%SZ")
            nl = h["y"].shape[0]
            h.close()
            ts = t0.replace(tzinfo=dt.timezone.utc).timestamp() + (t1 - t0).total_seconds() * a["FP_Line"] / max(nl - 1, 1)
            keep = a["FP_PersistentAnomalyCategory"] == 0
            return sat, key, {
                "t": ts[keep].astype(np.float64), "lat": a["FP_Latitude"][keep].astype(np.float32),
                "lon": a["FP_Longitude"][keep].astype(np.float32), "frp": a["FP_FireRadiativePower"][keep].astype(np.float32),
                "mask": a["FP_FireMask"][keep].astype(np.int8), "day": a["FP_Day"][keep].astype(np.int8),
                "bt4": a["FP_BT4um"][keep].astype(np.float32), "zen": a["FP_SatZenithAngle"][keep].astype(np.float32),
            }
        except Exception as exc:  # truncated or not-yet-complete granules
            err = exc
            time.sleep(1 + attempt)
    print(f"skip {key}: {err}", file=sys.stderr)
    return sat, key, None


def list_granules(bucket, day):
    import re
    import requests
    keys, token = [], None
    while True:
        url = f"https://{bucket}.s3.amazonaws.com/?list-type=2&prefix={PRODUCT}/{day:%Y/%m/%d}/"
        if token:
            url += "&continuation-token=" + requests.utils.quote(token, safe="")
        txt = requests.get(url, timeout=60).text
        keys += [(k, int(s)) for k, s in re.findall(r"<Key>([^<]+)</Key>.*?<Size>(\d+)</Size>", txt)]
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", txt)
        if not m:
            return keys
        token = m.group(1)


def granule_time(key):
    import re
    m = re.search(r"_s(\d{14})", key)
    return dt.datetime.strptime(m.group(1), "%Y%m%d%H%M%S").replace(tzinfo=dt.timezone.utc)


def scan(t_end, days, workers=32, deadline_s=900):
    t_start = t_end - dt.timedelta(days=days)
    tasks = []
    d = t_start.date()
    with cf.ThreadPoolExecutor(12) as ex:
        jobs = []
        while d <= t_end.date():
            for sat, bucket in SATELLITES.items():
                jobs.append((sat, bucket, ex.submit(list_granules, bucket, d)))
            d += dt.timedelta(days=1)
        for sat, bucket, fut in jobs:
            for key, size in fut.result():
                if t_start <= granule_time(key) <= t_end:
                    tasks.append((sat, bucket, key, size))
    print(f"scanning {len(tasks)} granules {t_start:%Y-%m-%d %H:%M} → {t_end:%Y-%m-%d %H:%M} UTC", file=sys.stderr)
    parts = []
    done = 0
    t0 = time.time()
    # forkserver: never fork a process that has run threads. A stuck worker must not hold the scan
    # hostage either: past the deadline, keep what came back and kill the pool.
    ex = cf.ProcessPoolExecutor(workers, mp_context=mp.get_context("forkserver"))
    futs = [ex.submit(_read, task) for task in tasks]
    try:
        for fut in cf.as_completed(futs, timeout=deadline_s):
            sat, key, r = fut.result()
            done += 1
            if r is not None:
                r["sat"] = np.full(len(r["t"]), list(SATELLITES).index(sat), np.int8)
                parts.append(r)
            if done % 500 == 0:
                print(f"  {done}/{len(tasks)} granules, {time.time() - t0:.0f}s", file=sys.stderr)
    except cf.TimeoutError:
        print(f"deadline: {len(tasks) - done} granules unread after {deadline_s}s, continuing without them", file=sys.stderr)
    finally:
        procs = list((ex._processes or {}).values())
        ex.shutdown(wait=False, cancel_futures=True)
        for pr in procs:
            if pr.is_alive():
                pr.kill()
    if not parts:
        return {k: np.array([]) for k in ("t", "lat", "lon", "frp", "mask", "day", "sat", "bt4", "zen")}
    px = {k: np.concatenate([p[k] for p in parts]) for k in parts[0]}
    order = np.argsort(px["t"])
    return {k: v[order] for k, v in px.items()}


def complexes(px, cell_deg=0.02, min_pixels=40):
    """8-connected components of occupied ~2 km cells."""
    if len(px["t"]) == 0:
        return np.array([], int), []
    ci = np.floor(px["lon"] / cell_deg).astype(np.int64)
    cj = np.floor(px["lat"] / cell_deg).astype(np.int64)
    key = ci * 100000 + cj
    cells, inv = np.unique(key, return_inverse=True)
    index = {int(k): i for i, k in enumerate(cells)}
    parent = np.arange(len(cells))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, k in enumerate(cells):
        x, y = divmod(int(k), 100000)
        if y > 50000:  # negative latitudes wrap with divmod; recompute
            x, y = x + 1, y - 100000
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                j = index.get((x + dx) * 100000 + (y + dy))
                if j is not None:
                    a, b = find(i), find(j)
                    if a != b:
                        parent[a] = b
    roots = np.array([find(i) for i in range(len(cells))])
    comp_of_pixel = roots[inv]
    out = []
    t_now = px["t"].max()
    for r in np.unique(comp_of_pixel):
        sel = comp_of_pixel == r
        n = int(sel.sum())
        if n < min_pixels:
            continue
        lon, lat, t = px["lon"][sel], px["lat"][sel], px["t"][sel]
        ncell = int(len(np.unique(key[sel])))
        recent = int((t > t_now - 24 * 3600).sum())
        out.append({
            "root": int(r), "pixels": n, "cells": ncell, "area_km2_est": round(ncell * (cell_deg * 111) ** 2 * np.cos(np.radians(float(lat.mean()))), 1),
            "frp_sum": round(float(px["frp"][sel].sum()), 1), "frp_max": round(float(px["frp"][sel].max()), 1),
            "recent_24h": recent, "first": float(t.min()), "last": float(t.max()),
            "bbox": [round(float(lon.min()), 3), round(float(lat.min()), 3), round(float(lon.max()), 3), round(float(lat.max()), 3)],
            "center": [round(float(np.average(lon, weights=px["frp"][sel] + 1)), 4), round(float(np.average(lat, weights=px["frp"][sel] + 1)), 4)],
        })
    # ranking: burned extent, weighted up when still active
    for c in out:
        c["score"] = round(c["cells"] * (1.0 + min(1.0, c["recent_24h"] / max(1, c["pixels"]) * 3)), 1)
    out.sort(key=lambda c: -c["score"])
    return comp_of_pixel, out


def world_layer(px, t_end, hours=48, deg=0.25):
    sel = px["t"] > t_end.timestamp() - hours * 3600
    lon, lat, frp = px["lon"][sel], px["lat"][sel], px["frp"][sel]
    i = np.floor((lon + 180) / deg).astype(int)
    j = np.floor((lat + 90) / deg).astype(int)
    key = i * 10000 + j
    u, inv, cnt = np.unique(key, return_inverse=True, return_counts=True)
    fsum = np.bincount(inv, weights=frp)
    return [[round((k // 10000) * deg - 180 + deg / 2, 3), round((k % 10000) * deg - 90 + deg / 2, 3), int(c), round(float(f), 1)]
            for k, c, f in zip(u, cnt, fsum)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=float, default=4)
    ap.add_argument("--end", help="UTC end time (ISO); default now")
    ap.add_argument("--raw", default=os.environ.get("WILDFIRE_RAW", "data/raw"))
    ap.add_argument("--out", default="public/data/live")
    ap.add_argument("--workers", type=int, default=32)
    a = ap.parse_args()
    t_end = dt.datetime.fromisoformat(a.end.replace("Z", "+00:00")) if a.end else dt.datetime.now(dt.timezone.utc)
    px = scan(t_end, a.days, a.workers)
    print(f"{len(px['t'])} fire pixels", file=sys.stderr)
    comp, cx = complexes(px)
    raw = os.path.join(a.raw, "live")
    os.makedirs(raw, exist_ok=True)
    np.savez_compressed(os.path.join(raw, "pixels.npz"), comp=comp, **px)
    with open(os.path.join(raw, "complexes.json"), "w") as f:
        json.dump({"t_end": t_end.isoformat(), "days": a.days, "complexes": cx}, f)
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "world.json"), "w") as f:
        json.dump({
            "updated": t_end.strftime("%Y-%m-%dT%H:%MZ"), "window_h": 48, "bin_deg": 0.25,
            "pixels_48h": int((px["t"] > t_end.timestamp() - 48 * 3600).sum()) if len(px["t"]) else 0,
            "bins": world_layer(px, t_end) if len(px["t"]) else [],
            "complexes": [{k: c[k] for k in ("center", "bbox", "pixels", "area_km2_est", "frp_max", "recent_24h", "first", "last")} for c in cx[:300]],
        }, f, separators=(",", ":"))
    print(f"{len(cx)} complexes ≥40 pixels; top: " + "; ".join(f"{c['center']} {c['area_km2_est']} km²" for c in cx[:8]), file=sys.stderr)


if __name__ == "__main__":
    main()
