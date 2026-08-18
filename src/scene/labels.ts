// Cartographic label placement: the 1971 signature. Names run along each
// territory's principal axis, bent to its midline, sized by area, culled by
// screen size, greedily pruned so nothing overlaps. Pure math + SVG strings;
// no React, no three.js scene objects - the overlay is one <svg>.

import * as THREE from "three";
import type { PeopleFeature } from "../data";
import { latLonToVec3 } from "./build";

export interface LabelSpec {
  id: string;
  text: string;
  sub: string | null;      // mono micro-label (language) shown at close zoom
  family: string;
  areaDeg2: number;
  // Baseline control points, lon/lat: start, mid, end along the midline.
  ctrl: [number, number][];
}

function ringArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
}

function centroidOf(ring: number[][]): [number, number] {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

// Intersections of the line through (px,py) with direction (dx,dy) against the
// ring; returns sorted signed distances t along the line.
function lineRingHits(ring: number[][], px: number, py: number, dx: number, dy: number): number[] {
  const ts: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j], [x2, y2] = ring[i];
    const ex = x2 - x1, ey = y2 - y1;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const s = ((px - x1) * dy - (py - y1) * dx) / -denom;
    if (s < 0 || s > 1) continue;
    const t = Math.abs(dx) > Math.abs(dy)
      ? (x1 + s * ex - px) / dx
      : (y1 + s * ey - py) / dy;
    ts.push(t);
  }
  return ts.sort((a, b) => a - b);
}

// Midpoint of the widest span of the ring along the perpendicular at station t.
function midlinePoint(
  ring: number[][], cx: number, cy: number,
  ax: number, ay: number, t: number,
): [number, number] {
  const px = cx + ax * t, py = cy + ay * t;
  const hits = lineRingHits(ring, px, py, -ay, ax);
  if (hits.length < 2) return [px, py];
  // widest interval containing 0 if possible, else overall widest
  let best: [number, number] | null = null;
  for (let i = 0; i + 1 < hits.length; i += 2) {
    const lo = hits[i], hi = hits[i + 1];
    const covers = lo <= 0 && hi >= 0;
    if (!best || covers || hi - lo > best[1] - best[0]) {
      if (covers) { best = [lo, hi]; break; }
      if (!best || hi - lo > best[1] - best[0]) best = [lo, hi];
    }
  }
  if (!best) return [px, py];
  const m = (best[0] + best[1]) / 2;
  return [px - ay * m, py + ax * m];
}

export function computeLabelSpec(f: PeopleFeature): LabelSpec {
  const polys = f.geometry.type === "Polygon"
    ? [f.geometry.coordinates as number[][][]]
    : (f.geometry.coordinates as number[][][][]);
  // Label the largest polygon only.
  let ring = polys[0][0], area = 0;
  for (const p of polys) {
    const a = ringArea(p[0]);
    if (a > area) { area = a; ring = p[0]; }
  }
  const [cx, cy] = centroidOf(ring);

  // Principal axis from the ring's covariance.
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of ring) {
    const dx = x - cx, dy = y - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ax = Math.cos(theta), ay = Math.sin(theta);
  if (ax < 0) { ax = -ax; ay = -ay; } // read west -> east

  // Half-length of the axis chord inside the ring.
  const hits = lineRingHits(ring, cx, cy, ax, ay);
  let lo = -Math.sqrt(area) / 2, hi = Math.sqrt(area) / 2;
  for (let i = 0; i + 1 < hits.length; i += 2)
    if (hits[i] <= 0 && hits[i + 1] >= 0) { lo = hits[i]; hi = hits[i + 1]; break; }
  const span = Math.min(hi, -lo) * 0.72; // stay inside the shape

  const p0 = midlinePoint(ring, cx, cy, ax, ay, -span);
  const p1 = midlinePoint(ring, cx, cy, ax, ay, 0);
  const p2 = midlinePoint(ring, cx, cy, ax, ay, span);

  return {
    id: f.properties.id,
    text: f.properties.name.toUpperCase(),
    sub: f.properties.language,
    family: f.properties.family,
    areaDeg2: area,
    ctrl: [[p0[0], p0[1]], [p1[0], p1[1]], [p2[0], p2[1]]],
  };
}

export interface PlacedLabel {
  spec: LabelSpec;
  path: string;        // SVG quadratic path, screen px
  fontPx: number;
  textLength: number | null;
  rect: { x: number; y: number; w: number; h: number };
  showSub: boolean;
}

export interface LayoutParams {
  minFontPx: number;   // the density threshold: labels smaller than this cull
  maxFontPx: number;
  subMinFontPx: number;
}

export const DEFAULT_PARAMS: LayoutParams = { minFontPx: 10, maxFontPx: 28, subMinFontPx: 19 };

const ALTITUDE = 1.006;

export interface LayoutResult {
  placed: PlacedLabel[];
  candidates: number; // specs in view before font/collision culling
}

export function layoutLabels(
  specs: LabelSpec[],
  camera: THREE.Camera,
  width: number,
  height: number,
  params: LayoutParams = DEFAULT_PARAMS,
): LayoutResult {
  const camDir = camera.position.clone().normalize();
  const placed: PlacedLabel[] = [];
  const taken: { x: number; y: number; w: number; h: number }[] = [];
  let candidates = 0;

  // Leaning in shrinks type relative to territory, like approaching a wall
  // map: cap tapers from maxFontPx at continental view to half at deep zoom.
  const dist = camera.position.length();
  const zoomT = Math.min(1, Math.max(0, (dist - 1.3) / (2.0 - 1.3)));
  const floorCap = Math.max(11, params.maxFontPx / 2.5);
  const effMaxFont = floorCap + (params.maxFontPx - floorCap) * zoomT;

  const project = (lon: number, lat: number): { x: number; y: number; facing: number } | null => {
    const world = latLonToVec3(lat, lon, ALTITUDE);
    const facing = world.clone().normalize().dot(camDir);
    const ndc = world.project(camera);
    if (ndc.z > 1) return null;
    return { x: (ndc.x + 1) / 2 * width, y: (1 - ndc.y) / 2 * height, facing };
  };

  const bySize = [...specs].sort((a, b) => b.areaDeg2 - a.areaDeg2);

  for (const spec of bySize) {
    const pts = spec.ctrl.map(([lon, lat]) => project(lon, lat));
    // Grazing-angle labels foreshorten unreadably and their glyph extents lie;
    // keep type on the facing two-thirds of the disc.
    if (pts.some(p => !p || p.facing < 0.35)) continue;
    const [a, m, b] = pts as { x: number; y: number }[];
    if ([a, m, b].some(p => p.x < -80 || p.x > width + 80 || p.y < -40 || p.y > height + 40)) continue;

    const baselineLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (baselineLen < 8) continue;
    candidates++;

    // Size by projected territory: baseline is ~0.72 of the axis chord.
    // Size so the set text (0.78em/char incl. tracking) fits inside the
    // baseline - glyphs past a path's end are clipped, not wrapped.
    const fontPx = Math.min(effMaxFont, Math.max(4, (baselineLen * 0.92) / (Math.max(4, spec.text.length) * 0.78)));
    if (fontPx < params.minFontPx) continue;

    // Keep text on a left-to-right baseline.
    const flip = a.x > b.x;
    const s = flip ? b : a, e = flip ? a : b;
    // Control point for the quadratic through the midline point.
    const cx = 2 * m.x - (s.x + e.x) / 2;
    const cy = 2 * m.y - (s.y + e.y) / 2;
    const path = `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${e.x.toFixed(1)} ${e.y.toFixed(1)}`;

    // Serif caps ≈ 0.7em advance + 0.08em tracking.
    const natural = spec.text.length * fontPx * 0.78;
    // Big type earns less tracking spread: stretch tapers from 2.2× at the
    // cull threshold to none at the size cap, so close zooms keep density.
    const sizeT = Math.min(1, Math.max(0, (fontPx - params.minFontPx) / (params.maxFontPx - params.minFontPx)));
    const stretchMax = 2.2 - sizeT * 1.2;
    const stretched = Math.min(baselineLen * 0.94, natural * stretchMax);
    const textLength = stretched > natural ? stretched : null;

    // Footprint: an oriented box around the set text, not the whole baseline -
    // a generous bbox over-prunes neighbours at close zoom.
    // The quadratic bows away from the chord; text follows it, so the
    // footprint must too or steeply-curved neighbours kiss.
    const bow = Math.hypot(m.x - (a.x + b.x) / 2, m.y - (a.y + b.y) / 2);
    const textW = (textLength ?? natural) + fontPx * 0.6;
    const textH = fontPx * 1.7 + bow;
    const dirX = (e.x - s.x) / baselineLen, dirY = (e.y - s.y) / baselineLen;
    const px = -dirY, py = dirX;
    const cx0 = (s.x + e.x) / 2 * 0.5 + m.x * 0.5;
    const cy0 = (s.y + e.y) / 2 * 0.5 + m.y * 0.5;
    const xs = [], ys = [];
    for (const [sw, sh] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      xs.push(cx0 + dirX * textW / 2 * sw + px * textH / 2 * sh);
      ys.push(cy0 + dirY * textW / 2 * sw + py * textH / 2 * sh);
    }
    const pad = 2;
    const collidesAt = (r: { x: number; y: number; w: number; h: number }) =>
      taken.some(t =>
        r.x < t.x + t.w + pad && t.x < r.x + r.w + pad &&
        r.y < t.y + t.h + pad && t.y < r.y + r.h + pad);

    // Atlas packing: if the midline slot is taken, stagger above/below it.
    let chosen: { rect: { x: number; y: number; w: number; h: number }; dy: number } | null = null;
    for (const shift of [0, -0.8, 0.8, -1.6, 1.6]) {
      const dx = px * textH * shift, dy = py * textH * shift;
      const r = {
        x: Math.min(...xs) + dx, y: Math.min(...ys) + dy,
        w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
      };
      if (!collidesAt(r)) { chosen = { rect: r, dy: textH * shift }; break; }
    }
    if (!chosen) continue;

    const finalPath = chosen.dy === 0 ? path :
      `M ${(s.x + px * chosen.dy).toFixed(1)} ${(s.y + py * chosen.dy).toFixed(1)} Q ${(cx + px * chosen.dy).toFixed(1)} ${(cy + py * chosen.dy).toFixed(1)} ${(e.x + px * chosen.dy).toFixed(1)} ${(e.y + py * chosen.dy).toFixed(1)}`;

    taken.push(chosen.rect);
    placed.push({
      spec, path: finalPath, fontPx, textLength,
      rect: chosen.rect,
      showSub: Boolean(spec.sub) && fontPx >= params.subMinFontPx,
    });
  }
  return { placed, candidates };
}
