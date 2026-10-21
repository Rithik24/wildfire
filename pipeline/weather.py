"""Hourly surface weather for an incident from NOAA's Integrated Surface Database.

Source: NOAA Global Hourly (ISD) CSV files on AWS (`noaa-global-hourly-pds`,
open). We use the airport station nearest the fire and keep one observation
per hour (the routine METAR closest to the top of the hour), decoding:

  WND  direction (deg), speed (m/s x10)
  OC1  gust (m/s x10)
  TMP  air temperature (C x10)
  DEW  dew point (C x10) -> relative humidity (Magnus formula)
  REM  METAR remarks: smoke (FU) and fire mentions are kept as events

Output: public/data/<id>/weather.json

    python -m pipeline.weather park-2024
"""

import argparse
import csv
import datetime as dt
import io
import json
import math
import os
import re

import requests

from .incidents import INCIDENTS

URL = "https://noaa-global-hourly-pds.s3.amazonaws.com/{year}/{station}.csv"
MISSING = {"9999", "+9999", "99999", "999"}


def parse_val(field, idx, scale=1.0, missing=("9999", "+9999", "99999")):
    try:
        parts = field.split(",")
        v = parts[idx]
        if v in missing:
            return None
        return float(v) / scale
    except (IndexError, ValueError, AttributeError):
        return None


def rh(t, td):
    if t is None or td is None:
        return None
    a, b = 17.625, 243.04
    return max(0.0, min(100.0, 100 * math.exp(a * td / (b + td)) / math.exp(a * t / (b + t))))


def load_station(station, years):
    rows = []
    meta = None
    for y in sorted(years):
        r = requests.get(URL.format(year=y, station=station), timeout=120)
        if r.status_code != 200:
            continue
        for row in csv.DictReader(io.StringIO(r.text)):
            meta = meta or {"id": station, "name": row["NAME"].strip(), "lat": float(row["LATITUDE"]),
                            "lon": float(row["LONGITUDE"]), "elev_m": float(row["ELEVATION"])}
            rows.append(row)
    return meta, rows


def decode(row):
    t = dt.datetime.fromisoformat(row["DATE"]).replace(tzinfo=dt.timezone.utc)
    wnd = row.get("WND", "")
    wdir = parse_val(wnd, 0, 1, ("999",))
    wtype = wnd.split(",")[2] if wnd.count(",") >= 3 else ""
    wspd = parse_val(wnd, 3, 10)
    if wtype == "C":  # calm
        wdir, wspd = None, 0.0
    if wtype == "V":
        wdir = None
    gust = parse_val(row.get("OC1", ""), 0, 10)
    temp = parse_val(row.get("TMP", ""), 0, 10)
    dew = parse_val(row.get("DEW", ""), 0, 10)
    rem = row.get("REM", "") or ""
    return {
        "t": t, "type": row.get("REPORT_TYPE", ""), "wdir": wdir, "wspd": wspd, "gust": gust,
        "temp": temp, "dew": dew, "rh": rh(temp, dew), "rem": rem,
    }


def run(incident_id, out_dir):
    inc = INCIDENTS[incident_id]
    meta_path = os.path.join(out_dir, incident_id, "incident.json")
    m = json.load(open(meta_path))
    t0 = dt.datetime.fromisoformat(m["t0"].replace("Z", "+00:00"))
    t1 = dt.datetime.fromisoformat(m["end"].replace("Z", "+00:00"))
    years = {t0.year, t1.year}
    stations = [inc["isd_station"]] + inc.get("isd_fallback", [])
    best = None
    for st in stations:
        meta, rows = load_station(st, years)
        obs = [decode(r) for r in rows]
        obs = [o for o in obs if t0 - dt.timedelta(hours=2) <= o["t"] <= t1 + dt.timedelta(hours=2)]
        good = sum(1 for o in obs if o["wspd"] is not None and o["temp"] is not None)
        print(f"  {st} {meta and meta['name']}: {len(obs)} obs, {good} usable")
        if meta and (best is None or good > best[2] * 1.2):
            best = (meta, obs, good)
        if good > 0.8 * (t1 - t0).total_seconds() / 3600:
            break
    meta, obs, _ = best

    hours = []
    h = t0.replace(minute=0, second=0, microsecond=0)
    while h <= t1:
        cand = [o for o in obs if abs((o["t"] - h).total_seconds()) <= 40 * 60 and o["wspd"] is not None]
        cand.sort(key=lambda o: (o["type"] not in ("FM-15", "FM-16"), abs((o["t"] - h).total_seconds())))
        o = cand[0] if cand else None
        # gusts are often only in the special reports: take the max reported in the hour
        g = [x["gust"] for x in obs if x["gust"] is not None and h - dt.timedelta(minutes=30) < x["t"] <= h + dt.timedelta(minutes=30)]
        hours.append({
            "t": int(h.timestamp()),
            "wspd": round(o["wspd"] * 3.6, 1) if o and o["wspd"] is not None else None,  # km/h
            "wdir": o["wdir"] if o else None,
            "gust": round(max(g) * 3.6, 1) if g else None,
            "temp": round(o["temp"], 1) if o and o["temp"] is not None else None,
            "rh": round(o["rh"], 0) if o and o["rh"] is not None else None,
        })
        h += dt.timedelta(hours=1)

    notes = []
    seen = set()
    for o in obs:
        r = o["rem"]
        metar = re.search(r"METAR (.*)", r)
        txt = metar.group(1) if metar else r
        if re.search(r"\bFIRE\b", txt) or re.search(r"\sFU\s", txt):
            day = o["t"].strftime("%Y-%m-%d")
            if re.search(r"\bFIRE\b", txt):
                key = ("fire", day)
            else:
                key = ("fu", day)
            if key in seen:
                continue
            seen.add(key)
            notes.append({"t": int(o["t"].timestamp()), "kind": key[0], "metar": txt.strip()[:160]})

    out = {
        "station": meta,
        "source": "NOAA Integrated Surface Database (Global Hourly), via AWS Open Data",
        "units": {"wspd": "km/h", "gust": "km/h", "temp": "C", "rh": "%", "wdir": "deg (from)"},
        "hourly": hours,
        "notes": notes,
    }
    with open(os.path.join(out_dir, incident_id, "weather.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    v = [x for x in hours if x["wspd"] is not None]
    print(f"{incident_id}: {len(v)}/{len(hours)} hours with wind; {len(notes)} smoke/fire remarks")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("incident", choices=sorted(INCIDENTS))
    ap.add_argument("--out", default="public/data")
    a = ap.parse_args()
    run(a.incident, a.out)
