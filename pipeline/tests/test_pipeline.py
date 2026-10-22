"""Unit tests for the pipeline's geometry and tracking logic (no network)."""

import math

import numpy as np

from pipeline.build_incident import disk, group_overpasses, haversine_km, track_hotspots
from pipeline.fetch_viirs import in_overpass_window
from pipeline.grid import Grid
from pipeline.weather import parse_val, rh


def test_grid_roundtrip_and_corners():
    g = Grid([-122.2, 39.7, -121.4, 40.4], 100)
    lon, lat = -121.8, 40.0
    c, r = g.to_pixel(lon, lat)
    lo, la = g.to_lonlat(c, r)
    assert abs(lo - lon) < 1e-9 and abs(la - lat) < 1e-9
    tl, tr, br, bl = g.corners()
    assert tl[0] == bl[0] and tr[0] == br[0]  # mercator-aligned
    assert tl[1] > bl[1]
    # ground resolution is honoured at the centre latitude
    assert abs(g.res / g.scale - 100) < 1e-9
    assert g.cell_area_ha == 1.0


def test_overpass_window():
    import datetime as dt
    # 13:30 local solar time at lon -120 is 21:30 UTC
    t = dt.datetime(2024, 7, 25, 21, 30, tzinfo=dt.timezone.utc)
    assert in_overpass_window(t, -120)
    assert not in_overpass_window(t.replace(hour=15), -120)
    assert in_overpass_window(t.replace(hour=9, minute=30), -120)  # 01:30 local


def test_group_overpasses_merges_consecutive_granules():
    g = [(0, "NOAA-20"), (85, "NOAA-20"), (170, "NOAA-20"), (3000, "NOAA-21"), (6000, "NOAA-20")]
    p = group_overpasses(g)
    assert [(x["sat"], x["t0"], x["t1"]) for x in p] == [("NOAA-20", 0, 170), ("NOAA-21", 3000, 3000), ("NOAA-20", 6000, 6000)]


def test_disk_shape():
    d = disk(2)
    assert d.shape == (5, 5) and d[2, 2] and not d[0, 0] and d.sum() == 13


def test_track_hotspots_links_moving_cluster():
    g = Grid([-121.0, 40.0, -120.0, 40.5], 100)
    # a cluster that moves ~2 km east between two overpasses, plus a far-away one-off
    lons = np.array([-120.80, -120.799, -120.78, -120.779, -120.30])
    lats = np.array([40.20, 40.201, 40.20, 40.201, 40.40])
    det = {
        "lon": lons, "lat": lats, "frp": np.array([50.0, 60.0, 80.0, 90.0, 5.0]),
        "bt4": np.array([340.0, 345.0, 350.0, 360.0, 320.0]), "t": np.array([0, 0, 43200, 43200, 43200]),
    }
    passes = [{"t": 0, "sat": "NOAA-20", "idx": np.array([0, 1])}, {"t": 43200, "sat": "NOAA-21", "idx": np.array([2, 3, 4])}]
    out = track_hotspots(det, passes, g)["tracks"]
    assert len(out) == 1  # the single-pixel 5 MW blip is dropped (one sighting, < 50 MW)
    tr = out[0]
    assert len(tr["obs"]) == 2 and tr["id"] == "HS-001"
    assert haversine_km(tr["obs"][0]["lon"], tr["obs"][0]["lat"], tr["obs"][1]["lon"], tr["obs"][1]["lat"]) < 4


def test_weather_decoding():
    assert parse_val("360,5,N,0098,5", 3, 10) == 9.8
    assert parse_val("+9999,9", 0, 10) is None
    assert abs(rh(20, 20) - 100) < 1e-6
    assert 3 < rh(18.3, -21.1) < 8  # Santa Ana: 18 °C over a -21 °C dew point is ~5 %


def test_haversine():
    assert abs(haversine_km(0, 0, 1, 0) - 111.19) < 0.1
    assert math.isclose(haversine_km(10, 10, 10, 10), 0.0)


def test_openmeteo_parse_window():
    import datetime as dt
    from pipeline.weather import parse_openmeteo
    j = {"hourly": {
        "time": ["2026-10-20T00:00", "2026-10-20T01:00", "2026-10-21T05:00"],
        "temperature_2m": [30.1, 29.5, 25.0], "relative_humidity_2m": [20, 22, 40],
        "wind_speed_10m": [12.0, 15.5, 3.0], "wind_direction_10m": [90, 100, 180], "wind_gusts_10m": [25.0, 30.0, 8.0],
    }}
    t0 = dt.datetime(2026, 10, 20, 1, tzinfo=dt.timezone.utc)
    t1 = dt.datetime(2026, 10, 20, 3, tzinfo=dt.timezone.utc)
    h = parse_openmeteo(j, t0, t1)
    assert [x["wspd"] for x in h] == [12.0, 15.5]
    assert h[1]["t"] == int(dt.datetime(2026, 10, 20, 1, tzinfo=dt.timezone.utc).timestamp())
    assert h[0]["rh"] == 20 and h[0]["gust"] == 25.0


def test_live_selection_spreads_fires():
    from pipeline.live import select
    base = {"recent_24h": 100, "pixels": 500, "cells": 50, "area_km2_est": 200, "first": 0, "last": 1, "root": 0}
    cx = [
        dict(base, center=[114.0, -2.5], bbox=[113.9, -2.6, 114.1, -2.4]),
        dict(base, center=[114.1, -2.6], bbox=[114.0, -2.7, 114.2, -2.5], area_km2_est=150),  # same fire region
        dict(base, center=[133.0, -17.7], bbox=[132.9, -17.8, 133.1, -17.6]),
        dict(base, center=[10.0, 10.0], bbox=[9.9, 9.9, 10.1, 10.1], recent_24h=0),  # out
    ]
    out = select(cx, 5)
    assert sorted(c["center"] for c in out) == [[114.0, -2.5], [133.0, -17.7]]


def test_gazetteer_ignores_unknown_population(tmp_path):
    import json
    from pipeline.live import Gazetteer
    feats = [
        {"geometry": {"coordinates": [10.0, 10.0]}, "properties": {"name": "Near", "adm1name": "A", "adm0name": "X", "pop_max": -99}},
        {"geometry": {"coordinates": [-60.0, -24.0]}, "properties": {"name": "Far", "adm1name": "B", "adm0name": "Y", "pop_max": 50000}},
    ]
    (tmp_path / "ne_places.geojson").write_text(json.dumps({"features": feats}))
    assert Gazetteer(str(tmp_path)).near(10.2, 10.1)["name"] == "Near"


def test_compass_dir():
    from pipeline.live import compass_dir
    assert compass_dir([0, 0], [0, 1]) == "N"
    assert compass_dir([0, 0], [1, 1]) == "NE"
    assert compass_dir([10, 10], [9, 10]) == "W"
