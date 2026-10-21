"""Web Mercator grid shared by every raster product of an incident.

Rasters are aligned to EPSG:3857 so the browser can drape them on the map
as an image source with exact corner coordinates.
"""

import math

import numpy as np
from pyproj import Transformer

R = 6378137.0
TO_3857 = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
TO_4326 = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)


class Grid:
    def __init__(self, bbox, ground_res_m):
        w, s, e, n = bbox
        self.bbox = bbox
        self.lat_c = (s + n) / 2
        self.scale = 1 / math.cos(math.radians(self.lat_c))  # mercator metres per ground metre
        self.res = ground_res_m * self.scale  # cell size in mercator units
        self.ground_res = ground_res_m
        x0, y0 = TO_3857.transform(w, s)
        x1, y1 = TO_3857.transform(e, n)
        self.width = int(math.ceil((x1 - x0) / self.res))
        self.height = int(math.ceil((y1 - y0) / self.res))
        self.x0, self.y1 = x0, y0 + self.height * self.res  # top-left corner
        self.x1, self.y0 = x0 + self.width * self.res, y0

    @property
    def cell_area_ha(self):
        return self.ground_res ** 2 / 1e4

    def to_pixel(self, lon, lat):
        x, y = TO_3857.transform(np.asarray(lon), np.asarray(lat))
        col = (x - self.x0) / self.res
        row = (self.y1 - y) / self.res
        return col, row

    def to_lonlat(self, col, row):
        x = self.x0 + np.asarray(col) * self.res
        y = self.y1 - np.asarray(row) * self.res
        return TO_4326.transform(x, y)

    def corners(self):
        """[top-left, top-right, bottom-right, bottom-left] lon/lat, MapLibre image-source order."""
        pts = [(self.x0, self.y1), (self.x1, self.y1), (self.x1, self.y0), (self.x0, self.y0)]
        return [[round(v, 6) for v in TO_4326.transform(x, y)] for x, y in pts]

    def affine(self):
        from rasterio.transform import from_origin
        return from_origin(self.x0, self.y1, self.res, self.res)

    def describe(self):
        return {
            "crs": "EPSG:3857", "width": self.width, "height": self.height,
            "res_m": self.ground_res, "res_mercator": self.res,
            "x0": self.x0, "y1": self.y1, "corners": self.corners(),
        }
