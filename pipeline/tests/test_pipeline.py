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
