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

/** Degrees within which a region counts as "near" a vignette. Wide enough
 *  that exploring the area around a landmark reveals it; 12 vignettes across
 *  835 regions would otherwise almost never fire. */
const NEAR_DEG = 4;

function minDist2(f: PeopleFeature, lon: number, lat: number): number {
  let bd = Infinity;
  for (const rings of polys(f))
    for (const [x, y] of rings[0] ?? []) {
      const d = (x - lon) ** 2 + (y - lat) ** 2;
      if (d < bd) bd = d;
    }
  return bd;
}

const cache = new WeakMap<object, Map<string, Set<string>>>();

/** vignette id -> region ids that reveal it (the containing polygon plus any
 *  region with a boundary vertex within NEAR_DEG; nearest as last resort). */
export function vignetteRegionMap(
  peoples: PeopleFeature[],
  vignettes: VignetteDef[],
): Map<string, Set<string>> {
  const hit = cache.get(vignettes);
  if (hit) return hit;
  const map = new Map<string, Set<string>>();
  const near2 = NEAR_DEG * NEAR_DEG;
  for (const v of vignettes) {
    const owners = new Set<string>();
    let nearest: string | null = null, nd = Infinity;
    for (const f of peoples) {
      const d = minDist2(f, v.lon, v.lat);
      if (d < nd) { nd = d; nearest = f.properties.id; }
      if (d <= near2 || contains(f, v.lon, v.lat)) owners.add(f.properties.id);
    }
    if (!owners.size && nearest) owners.add(nearest);
    map.set(v.id, owners);
  }
  cache.set(vignettes, map);
  return map;
}
