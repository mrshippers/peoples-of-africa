#!/usr/bin/env python3
"""Bake the diorama textures from the equirect DEM + Natural Earth II hues.

Outputs (public/terrain/):
  albedo.jpg  4096x3856 - NE2 biome hues x z7 hillshade on land; bathymetric
              ramp on the seabed (the turquoise-shelf look), painterly grade.
  height.png  2048x1928 - packed metres: R=hi, G=lo of (h + 11000).
  normal.jpg  2048x1928 - normals of the *exaggerated* height field, so
              runtime lighting matches displacement.

Vertical scale contract (must match src/scene/terrain.ts):
  world units: plate width 8.5 (=85 deg), height 8.0 (=80 deg)
  land:   z = h * 22 / 1.11e6
  seabed: z = h * 10 / 1.11e6
"""

import os
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
OUT = os.path.join(ROOT, "public", "terrain")
os.makedirs(OUT, exist_ok=True)

NE2_TIF = sys.argv[1] if len(sys.argv) > 1 else os.path.join(CACHE, "NE2_50M_SR_W.tif")
BBOX = {"west": -25.0, "east": 60.0, "south": -40.0, "north": 40.0}

dem = np.load(os.path.join(CACHE, "dem_africa.npy"))  # (3856, 4096) metres
H, W = dem.shape

# ── NE2 crop -> plate grid ──
ne2 = Image.open(NE2_TIF)  # 10800x5400, global equirect
nw, nh = ne2.size
px = lambda lon: (lon + 180.0) / 360.0 * nw
py = lambda lat: (90.0 - lat) / 180.0 * nh
crop = ne2.crop((int(px(BBOX["west"])), int(py(BBOX["north"])),
                 int(px(BBOX["east"])), int(py(BBOX["south"]))))
hue = np.asarray(crop.resize((W, H), Image.LANCZOS), np.float32) / 255.0

# ── masks ──
land = dem >= 0.0

# Ocean = below-sea-level pixels connected to the plate border; everything else
# wet is a lake (Caspian at -28m renders as absurd shallow sea otherwise).
def ocean_mask(wet):
    small = np.asarray(Image.fromarray(wet.astype(np.uint8) * 255)
                       .resize((1024, 964), Image.NEAREST)) > 0
    reach = np.zeros_like(small)
    reach[0, :] = small[0, :]; reach[-1, :] = small[-1, :]
    reach[:, 0] |= small[:, 0]; reach[:, -1] |= small[:, -1]
    while True:
        grown = reach.copy()
        grown[1:, :] |= reach[:-1, :]; grown[:-1, :] |= reach[1:, :]
        grown[:, 1:] |= reach[:, :-1]; grown[:, :-1] |= reach[:, 1:]
        grown &= small
        if (grown == reach).all():
            break
        reach = grown
    return np.asarray(Image.fromarray(reach.astype(np.uint8) * 255)
                      .resize(wet.shape[::-1], Image.NEAREST)) > 0

ocean = ocean_mask(~land)
inland_water = (~land) & (~ocean)

# ── hillshade from the exaggerated field (matches what the eye will see) ──
S_LAND, S_SEA = 22.0 / 1.11e6, 10.0 / 1.11e6
zfield = np.where(land, dem * S_LAND, dem * S_SEA)
# grid spacing in world units per pixel
dx = 8.5 / W
dy = 8.0 / H
gy, gx = np.gradient(zfield, dy, dx)
# sun from the north-west, 42 deg altitude
az, alt = np.radians(315.0), np.radians(42.0)
sx, sy, sz = np.cos(alt) * np.sin(az), np.cos(alt) * np.cos(az), np.sin(alt)
norm = np.sqrt(gx * gx + gy * gy + 1.0)
shade = np.clip((-gx * sx + gy * sy + sz) / norm, 0.0, 1.0)
shade = shade ** 1.15

# ── seabed bathymetric ramp ──
def ramp(depth):
    """depth positive metres below sea level -> RGB float"""
    stops = [
        (0.0,    (0.92, 0.86, 0.66)),   # waterline sand
        (12.0,   (0.62, 0.86, 0.80)),   # bright shallow
        (80.0,   (0.22, 0.66, 0.66)),   # turquoise shelf
        (400.0,  (0.10, 0.36, 0.47)),   # slope
        (2000.0, (0.055, 0.16, 0.27)),  # abyss blue
        (7000.0, (0.03, 0.075, 0.14)),  # deep navy
    ]
    out = np.zeros(depth.shape + (3,), np.float32)
    d = np.clip(depth, 0, 7000)
    for (d0, c0), (d1, c1) in zip(stops, stops[1:]):
        m = (d >= d0) & (d <= d1)
        t = np.where(m, (d - d0) / (d1 - d0), 0.0)[..., None]
        seg = (1 - t) * np.array(c0) + t * np.array(c1)
        out = np.where(m[..., None], seg, out)
    return out

sea_rgb = ramp(np.maximum(0.0, -dem))

# ── land grade: NE2 hue, saturation lift, warm, crisp shade ──
land_rgb = hue.copy()
mean = land_rgb.mean(axis=2, keepdims=True)
land_rgb = np.clip(mean + (land_rgb - mean) * 1.38, 0, 1)          # saturation
land_rgb = np.clip(land_rgb * np.array([1.05, 1.01, 0.94]), 0, 1)  # warmth
land_rgb = land_rgb ** 0.95                                        # lift

# Lakes from the Natural Earth vector layer (the NE2 raster leaves them
# unpainted; Victoria samples as khaki). Rasterized onto the plate grid.
import json
from PIL import ImageDraw

lake_rgb = np.array([0.16, 0.40, 0.48], np.float32)
lakes_img = Image.new("L", (W, H), 0)
draw = ImageDraw.Draw(lakes_img)
to_px = lambda lon, lat: ((lon - BBOX["west"]) / 85.0 * W,
                          (BBOX["north"] - lat) / 80.0 * H)
lakes_fc = json.load(open(os.path.join(CACHE, "ne_50m_lakes.geojson")))
for f in lakes_fc["features"]:
    g = f["geometry"]
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    for poly in polys:
        pts = [to_px(x, y) for x, y in poly[0]]
        if all(p[0] < -2 or p[0] > W + 2 or p[1] < -2 or p[1] > H + 2 for p in pts):
            continue
        draw.polygon(pts, fill=255)
lakes = np.asarray(lakes_img) > 0
land_rgb = np.where(lakes[..., None], lake_rgb, land_rgb)

# Below-sea inland water (Afar) gets the lake tint, not the ramp - and the
# Caspian explicitly: Natural Earth files it under ocean polygons, not lakes,
# and the flood-fill calls it ocean where it touches the plate's north edge.
lon_grid = np.linspace(BBOX["west"], BBOX["east"], W)[None, :]
lat_grid = np.linspace(BBOX["north"], BBOX["south"], H)[:, None]
caspian = (~land) & (lon_grid > 44.0) & (lat_grid > 34.0)
sea_rgb = np.where((inland_water | lakes | caspian)[..., None], lake_rgb, sea_rgb)

shade_strength = np.where(land, 1.0, 0.62).astype(np.float32)
lit = 0.35 + 0.65 * (shade * shade_strength + (1 - shade_strength))
rgb = np.where(land[..., None], land_rgb, sea_rgb) * lit[..., None]

# gentle painterly S-curve
rgb = np.clip(rgb, 0, 1)
rgb = rgb * rgb * (3.0 - 2.0 * rgb) * 0.25 + rgb * 0.75

Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).save(
    os.path.join(OUT, "albedo.jpg"), quality=86)

# low-res albedo for progressive first paint
Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).resize(
    (1024, 964), Image.LANCZOS).save(os.path.join(OUT, "albedo_lo.jpg"), quality=80)

# ── packed heightmap (quarter res - matches the 1024-segment plate) ──
hw, hh = W // 4, H // 4
dem_small = np.asarray(Image.fromarray(dem).resize((hw, hh), Image.BILINEAR))
packed = np.zeros((hh, hw, 3), np.uint8)
enc = np.clip(dem_small + 11000.0, 0, 65535).astype(np.uint16)
packed[..., 0] = (enc >> 8).astype(np.uint8)
packed[..., 1] = (enc & 0xFF).astype(np.uint8)
Image.fromarray(packed).save(os.path.join(OUT, "height.png"), optimize=True)

# ── normal map of the exaggerated field (half res) ──
z_small = np.asarray(Image.fromarray(zfield).resize((hw, hh), Image.BILINEAR))
gy2, gx2 = np.gradient(z_small, 8.0 / hh, 8.5 / hw)
nz = 1.0 / np.sqrt(gx2 * gx2 + gy2 * gy2 + 1.0)
nx, ny = -gx2 * nz, gy2 * nz
normal = np.stack([(nx * 0.5 + 0.5), (ny * 0.5 + 0.5), (nz * 0.5 + 0.5)], axis=-1)
Image.fromarray((np.clip(normal, 0, 1) * 255).astype(np.uint8)).save(
    os.path.join(OUT, "normal.jpg"), quality=88)

for f in ["albedo.jpg", "albedo_lo.jpg", "height.png", "normal.jpg"]:
    print(f, f"{os.path.getsize(os.path.join(OUT, f))/1e6:.2f} MB")
