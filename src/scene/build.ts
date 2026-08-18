// Geometry construction for the globe: GeoJSON polygons -> spherical meshes.
// Plain three.js, no React. Units: degrees in, unit-sphere radii out.

import * as THREE from "three";
import type { PeopleFeature, FamilyName } from "../data";

export const GLOBE_RADIUS = 1;
export const LAYER_ALTITUDE = 1.0035;   // polygon drape height above sphere
export const OUTLINE_ALTITUDE = 1.0042; // outlines sit just above fills

// lon/lat (degrees) -> position matching SphereGeometry's equirect UV layout.
export function latLonToVec3(lat: number, lon: number, r: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

// Triangulate one GeoJSON polygon (outer ring + holes) in the lon/lat plane.
// Returns flat triangle list as [lon, lat] pairs.
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

// Long chords dip below the sphere when projected; split triangles until no
// edge exceeds maxDeg so the drape hugs the surface.
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

// Build one merged non-indexed geometry per family. Each group's triangles are
// contiguous, so a face index maps to a group by range lookup and a highlight
// can be drawn with setDrawRange over the same buffers.
export function buildFamilyMeshes(
  features: PeopleFeature[],
  opts: { altitude?: number; maxEdgeDeg?: number } = {},
): FamilyMeshData[] {
  const altitude = opts.altitude ?? LAYER_ALTITUDE;
  const maxEdge = opts.maxEdgeDeg ?? 3;
  const byFamily = new Map<FamilyName, PeopleFeature[]>();
  for (const f of features) {
    const fam = f.properties.family;
    if (!byFamily.has(fam)) byFamily.set(fam, []);
    byFamily.get(fam)!.push(f);
  }

  const result: FamilyMeshData[] = [];
  for (const [family, feats] of byFamily) {
    const positions: number[] = [];
    const ranges: GroupRange[] = [];
    for (const f of feats) {
      const triStart = positions.length / 9;
      for (const poly of polygonsOf(f)) {
        const tris = subdivide(triangulate(poly), maxEdge);
        for (const [lon, lat] of tris) {
          const v = latLonToVec3(lat, lon, altitude);
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

// One merged LineSegments geometry of every group outline (single ink colour).
export function buildOutlines(features: PeopleFeature[], altitude = OUTLINE_ALTITUDE): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const f of features) {
    for (const poly of polygonsOf(f)) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          const a = latLonToVec3(ring[i][1], ring[i][0], altitude);
          const b = latLonToVec3(ring[i + 1][1], ring[i + 1][0], altitude);
          positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

// Heritage extents: same drape, one geometry per polity (they toggle by year).
export function buildExtentGeometry(ring: [number, number][], altitude = LAYER_ALTITUDE): THREE.BufferGeometry {
  const tris = subdivide(triangulate([ring]), 2.5);
  const positions: number[] = [];
  for (const [lon, lat] of tris) {
    const v = latLonToVec3(lat, lon, altitude);
    positions.push(v.x, v.y, v.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}
