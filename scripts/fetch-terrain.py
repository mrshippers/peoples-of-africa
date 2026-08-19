#!/usr/bin/env python3
"""Fetch AWS terrarium elevation tiles for the Africa plate and reproject to
an equirectangular DEM.

Source: s3.amazonaws.com/elevation-tiles-prod (Mapzen/AWS Open Data, terrarium
encoding: h = R*256 + G + B/256 - 32768, includes bathymetry).

Output: .cache/dem_africa.npy - float32 metres, equirect, BBOX below.
"""

import math
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from urllib.request import urlopen

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
TILES = os.path.join(CACHE, "terrarium")
os.makedirs(TILES, exist_ok=True)

Z = 7
N = 2 ** Z
# The plate: lon west..east, lat south..north.
BBOX = {"west": -25.0, "east": 60.0, "south": -40.0, "north": 40.0}
OUT_W, OUT_H = 4096, 3856  # 85° x 80° at ~48 px/deg

def lon_to_xf(lon): return (lon + 180.0) / 360.0 * N
def lat_to_yf(lat):
    r = math.radians(lat)
    return (1.0 - math.asinh(math.tan(r)) / math.pi) / 2.0 * N

x0, x1 = int(lon_to_xf(BBOX["west"])), int(lon_to_xf(BBOX["east"]))
y0, y1 = int(lat_to_yf(BBOX["north"])), int(lat_to_yf(BBOX["south"]))

def fetch(xy):
    x, y = xy
    path = os.path.join(TILES, f"{Z}_{x}_{y}.png")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return 0
    url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png"
    for attempt in range(3):
        try:
            data = urlopen(url, timeout=30).read()
            with open(path, "wb") as f:
                f.write(data)
            return 1
        except Exception as e:
            if attempt == 2:
                print(f"FAILED {x},{y}: {e}", file=sys.stderr)
                raise
    return 1

coords = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
print(f"tiles: {len(coords)} (x {x0}..{x1}, y {y0}..{y1})")
with ThreadPoolExecutor(16) as ex:
    fetched = sum(ex.map(fetch, coords))
print(f"fetched {fetched} new")

# Stitch into one Mercator array.
tw = 256
merc = np.zeros(((y1 - y0 + 1) * tw, (x1 - x0 + 1) * tw), np.float32)
for x in range(x0, x1 + 1):
    for y in range(y0, y1 + 1):
        img = np.asarray(Image.open(os.path.join(TILES, f"{Z}_{x}_{y}.png")), np.float32)
        h = img[..., 0] * 256.0 + img[..., 1] + img[..., 2] / 256.0 - 32768.0
        merc[(y - y0) * tw:(y - y0 + 1) * tw, (x - x0) * tw:(x - x0 + 1) * tw] = h

# Reproject Mercator -> equirect by per-row resampling (bilinear).
lons = np.linspace(BBOX["west"], BBOX["east"], OUT_W)
lats = np.linspace(BBOX["north"], BBOX["south"], OUT_H)
xs = (np.array([lon_to_xf(l) for l in lons]) - x0) * tw
out = np.zeros((OUT_H, OUT_W), np.float32)
xi = np.clip(xs, 0, merc.shape[1] - 1.001)
x_lo = xi.astype(int); x_frac = xi - x_lo
for row, lat in enumerate(lats):
    yf = (lat_to_yf(lat) - y0) * tw
    yf = min(max(yf, 0.0), merc.shape[0] - 1.001)
    y_lo = int(yf); y_frac = yf - y_lo
    r0 = merc[y_lo, x_lo] * (1 - x_frac) + merc[y_lo, x_lo + 1] * x_frac
    r1 = merc[y_lo + 1, x_lo] * (1 - x_frac) + merc[y_lo + 1, x_lo + 1] * x_frac
    out[row] = r0 * (1 - y_frac) + r1 * y_frac

np.save(os.path.join(CACHE, "dem_africa.npy"), out)
print(f"dem_africa.npy: {out.shape}, min {out.min():.0f}m, max {out.max():.0f}m")
