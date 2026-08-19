// Geometry construction: GeoJSON polygons -> meshes draped through a
// pluggable projector. The diorama projects lon/lat onto the displaced plate;
// tests can pass any projector. Plain three.js, no React.

import * as THREE from "three";
import type { PeopleFeature, FamilyName } from "../data";

export type ProjectFn = (lon: number, lat: number) => THREE.Vector3;

// Triangulate one GeoJSON polygon (outer ring + holes) in the lon/lat plane.
function triangulate(rings: number[][][]): [number, number][] {
  const outer = rings[0].map(([x, y]) => new THREE.Vector2(x, y));
  const holes = rings.slice(1).map(ring => ring.map(([x, y]) => new THREE.Vector2(x, y)));
  const tris = THREE.ShapeUtils.triangulateShape(outer, holes);
  const all = outer.concat(...holes);
  const out: [number, number][] = [];
  for (const [a, b, c] of tris) {
    out.push([all[a].x, all[a].y], [all[b].x, all[b].y], [all[c].x, all[c].y]);
  }
  return out;
}

// Split triangles until no edge exceeds maxDeg so drapes follow the terrain.
function subdivide(tris: [number, number][], maxDeg: number): [number, number][] {
  const out: [number, number][] = [];
  const stack: [number, number][][] = [];
  for (let i = 0; i < tris.length; i += 3) stack.push([tris[i], tris[i + 1], tris[i + 2]]);
  const d2 = (p: [number, number], q: [number, number]) => {
    const dx = p[0] - q[0], dy = p[1] - q[1];
    return dx * dx + dy * dy;
  };
  const mid = (p: [number, number], q: [number, number]): [number, number] =>
    [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const max2 = maxDeg * maxDeg;
  while (stack.length) {
    const [a, b, c] = stack.pop()!;
    const ab = d2(a, b), bc = d2(b, c), ca = d2(c, a);
    const m = Math.max(ab, bc, ca);
    if (m <= max2) { out.push(a, b, c); continue; }
    if (m === ab) { const p = mid(a, b); stack.push([a, p, c], [p, b, c]); }
    else if (m === bc) { const p = mid(b, c); stack.push([a, b, p], [a, p, c]); }
    else { const p = mid(c, a); stack.push([a, b, p], [b, c, p]); }
  }
  return out;
}

export interface GroupRange { id: string; index: number; triStart: number; triCount: number }

export interface FamilyMeshData {
  family: FamilyName;
  geometry: THREE.BufferGeometry; // non-indexed, contiguous per-group ranges
  ranges: GroupRange[];           // sorted by triStart
}

function polygonsOf(f: PeopleFeature): number[][][][] {
  return f.geometry.type === "Polygon"
    ? [f.geometry.coordinates as number[][][]]
    : (f.geometry.coordinates as number[][][][]);
}

export interface BuildOpts {
  project: ProjectFn;
  maxEdgeDeg?: number;
  strategy?: "family" | "group";
}

// One merged non-indexed geometry per family; each group's triangles are
// contiguous so a face index resolves to a group and a highlight can reuse
// the buffers with setDrawRange. Strategy "group" is for the perf sweep.
export function buildFamilyMeshes(features: PeopleFeature[], opts: BuildOpts): FamilyMeshData[] {
  const maxEdge = opts.maxEdgeDeg ?? 0.9;
  const byFamily = new Map<string, PeopleFeature[]>();
  for (const f of features) {
    const key = opts.strategy === "group" ? f.properties.id : f.properties.family;
    if (!byFamily.has(key)) byFamily.set(key, []);
    byFamily.get(key)!.push(f);
  }

  const result: FamilyMeshData[] = [];
  for (const [, feats] of byFamily) {
    const family = feats[0].properties.family;
    const positions: number[] = [];
    const ranges: GroupRange[] = [];
    for (const f of feats) {
      const triStart = positions.length / 9;
      for (const poly of polygonsOf(f)) {
        const tris = subdivide(triangulate(poly), maxEdge);
        for (const [lon, lat] of tris) {
          const v = opts.project(lon, lat);
          positions.push(v.x, v.y, v.z);
        }
      }
      const triCount = positions.length / 9 - triStart;
      ranges.push({ id: f.properties.id, index: 0, triStart, triCount });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    result.push({ family, geometry, ranges });
  }
  return result;
}

// One merged LineSegments geometry of every group outline.
export function buildOutlines(features: PeopleFeature[], project: ProjectFn, maxSegDeg = 0.5): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const f of features) {
    for (const poly of polygonsOf(f)) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          // densify long outline segments so they hug the terrain
          const [lon0, lat0] = ring[i], [lon1, lat1] = ring[i + 1];
          const steps = Math.max(1, Math.ceil(Math.hypot(lon1 - lon0, lat1 - lat0) / maxSegDeg));
          for (let s = 0; s < steps; s++) {
            const t0 = s / steps, t1 = (s + 1) / steps;
            const a = project(lon0 + (lon1 - lon0) * t0, lat0 + (lat1 - lat0) * t0);
            const b = project(lon0 + (lon1 - lon0) * t1, lat0 + (lat1 - lat0) * t1);
            positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
          }
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

// Heritage extents: one geometry per polity.
export function buildExtentGeometry(ring: [number, number][], project: ProjectFn): THREE.BufferGeometry {
  const tris = subdivide(triangulate([ring]), 0.9);
  const positions: number[] = [];
  for (const [lon, lat] of tris) {
    const v = project(lon, lat);
    positions.push(v.x, v.y, v.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}
