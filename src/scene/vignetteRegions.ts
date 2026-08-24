// Resolve each vignette to the people-region that contains it, so vignettes
// can reveal on region hover. Offshore vignettes (the dhow) fall back to the
// nearest region ring so every vignette stays reachable from some region.

import type { PeopleFeature } from "../data";
import type { VignetteDef } from "../state";

type Ring = number[][];

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function polys(f: PeopleFeature): Ring[][] {
  return f.geometry.type === "Polygon"
    ? [f.geometry.coordinates as Ring[]]
    : (f.geometry.coordinates as Ring[][]);
}

function contains(f: PeopleFeature, lon: number, lat: number): boolean {
  return polys(f).some(rings => {
    if (!rings.length || !inRing(lon, lat, rings[0])) return false;
    return rings.slice(1).every(hole => !inRing(lon, lat, hole));
  });
}

function nearestId(fs: PeopleFeature[], lon: number, lat: number): string | null {
  let best: string | null = null, bd = Infinity;
  for (const f of fs)
    for (const rings of polys(f))
      for (const [x, y] of rings[0] ?? []) {
        const d = (x - lon) ** 2 + (y - lat) ** 2;
        if (d < bd) { bd = d; best = f.properties.id; }
      }
  return best;
}

const cache = new WeakMap<object, Map<string, string>>();

/** vignette id -> owning region id (containing polygon, else nearest). */
export function vignetteRegionMap(
  peoples: PeopleFeature[],
  vignettes: VignetteDef[],
): Map<string, string> {
  const hit = cache.get(vignettes);
  if (hit) return hit;
  const map = new Map<string, string>();
  for (const v of vignettes) {
    const owner = peoples.find(f => contains(f, v.lon, v.lat))?.properties.id
      ?? nearestId(peoples, v.lon, v.lat);
    if (owner) map.set(v.id, owner);
  }
  cache.set(vignettes, map);
  return map;
}
