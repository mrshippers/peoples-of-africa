// Cartographic typography over the diorama. One SVG overlay; labels lay out
// when the camera settles and fade while it moves. Projection goes through
// the terrain so type sits on the land it names.

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useApp } from "../state";
import { computeLabelSpec, layoutLabels, DEFAULT_PARAMS } from "./labels";
import type { LabelSpec, LayoutParams, PlacedLabel, LabelProjector } from "./labels";
import { registerTestApi } from "./testApi";
import type { PeopleFeature } from "../data";
import { mapToWorld } from "./terrain";
import { ZOOM_MIN, ZOOM_MAX } from "./DioramaScene";

const SETTLE_FRAMES = 6;

function politySpecs(polities: { id: string; name: string; start: number; end: number; extent: [number, number][] }[]): LabelSpec[] {
  return polities.map(p => computeLabelSpec({
    properties: {
      id: p.id, name: p.name, family: "heritage" as never,
      language: `${p.start < 0 ? -p.start + " BCE" : p.start} – ${p.end < 0 ? -p.end + " BCE" : p.end}`,
      glottocode: null, group: null, ea: null, lat: 0, lon: 0,
    },
    geometry: { type: "Polygon", coordinates: [p.extent] },
  } as PeopleFeature));
}

export function LabelLayer() {
  const { camera, gl, size } = useThree();
  const peoples = useApp(s => s.peoples);
  const heritage = useApp(s => s.heritage);
  const heightField = useApp(s => s.heightField);
  const layer = useApp(s => s.layer);
  const year = useApp(s => s.year);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const params = useRef<LayoutParams>({ ...DEFAULT_PARAMS });
  const lastMatrix = useRef(new THREE.Matrix4());
  const stillFrames = useRef(0);
  const dirty = useRef(true);
  const lastPlaced = useRef<PlacedLabel[]>([]);
  const lastCandidates = useRef(0);
  const lastEligible = useRef(0);

  const peopleSpecs = useMemo(
    () => (peoples ? peoples.map(computeLabelSpec) : []),
    [peoples],
  );
  const heritageSpecs = useMemo(
    () => (heritage ? politySpecs(heritage.polities) : []),
    [heritage],
  );

  useEffect(() => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "labels-overlay");
    svg.setAttribute("aria-hidden", "true");
    gl.domElement.parentElement?.appendChild(svg);
    svgRef.current = svg;
    return () => svg.remove();
  }, [gl]);

  const activeSpecs = (): LabelSpec[] => {
    if (layer === "peoples") return peopleSpecs;
    const y = useApp.getState().year;
    const live = new Set(
      (heritage?.polities ?? []).filter(p => y >= p.start && y <= p.end).map(p => p.id),
    );
    return heritageSpecs.filter(s => live.has(s.id));
  };

  const relayout = () => {
    const svg = svgRef.current;
    if (!svg || !heightField) return;
    const projector: LabelProjector = (lon, lat) => {
      const world = mapToWorld(lon, lat, Math.max(0, heightField.worldY(lon, lat)) + 0.02);
      const ndc = world.project(camera);
      if (ndc.z > 1 || ndc.z < -1) return null;
      return { x: (ndc.x + 1) / 2 * size.width, y: (1 - ndc.y) / 2 * size.height };
    };

    // Vignette tags first: they own their spots; cartographic labels avoid them.
    const vigs = useApp.getState().vignettes ?? [];
    const tagParts: string[] = [];
    const tagRects: { x: number; y: number; w: number; h: number }[] = [];
    for (const v of vigs) {
      const p = projector(v.lon, v.lat);
      if (!p || p.x < 20 || p.x > size.width - 20 || p.y < 30 || p.y > size.height - 20) continue;
      const wMain = v.label.length * 6.4 + 18;
      const wSub = v.sub.length * 5.0 + 18;
      const w = Math.max(wMain, wSub);
      const h = 30;
      let bx = Math.min(p.x + 16, size.width - w - 10);
      let by = Math.max(10, p.y - 40);
      // tags dodge each other by stepping upward
      const hits = (x: number, y: number) => tagRects.some(t =>
        x < t.x + t.w + 4 && t.x < x + w + 4 && y < t.y + t.h + 4 && t.y < y + h + 4);
      for (let tries = 0; tries < 5 && hits(bx, by); tries++) by -= h + 12;
      tagRects.push({ x: bx - 4, y: by - 4, w: w + 8, h: h + 8 });
      tagParts.push(
        `<line class="tag-lead" x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${(by + h).toFixed(1)}"/>`,
        `<circle class="tag-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.4"/>`,
        `<rect class="tag-box" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${w.toFixed(0)}" height="${h}"/>`,
        `<text class="tag-title" x="${(bx + 9).toFixed(1)}" y="${(by + 13).toFixed(1)}">${v.label}</text>`,
        `<text class="tag-sub" x="${(bx + 9).toFixed(1)}" y="${(by + 24).toFixed(1)}">${v.sub}</text>`,
      );
    }
    // Heritage sub-labels are the polity dates - show them at smaller type
    // than the peoples' language micro-labels.
    const effParams = layer === "peoples"
      ? params.current
      : { ...params.current, subMinFontPx: 12 };
    const dist = camera.position.distanceTo(new THREE.Vector3(0, 0, 0.2));
    const zoomT = (dist - ZOOM_MIN * 1.6) / (ZOOM_MAX * 0.8 - ZOOM_MIN * 1.6);
    const { placed, candidates, eligible } = layoutLabels(
      activeSpecs(), projector, size.width, size.height, effParams, zoomT, tagRects);
    lastPlaced.current = placed;
    lastCandidates.current = candidates;
    lastEligible.current = eligible;
    svg.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
    svg.setAttribute("width", String(size.width));
    svg.setAttribute("height", String(size.height));
    const isHeritage = layer !== "peoples";
    const parts: string[] = ["<defs>"];
    for (const p of placed)
      parts.push(`<path id="lp-${p.spec.id}" d="${p.path}" fill="none"/>`);
    parts.push("</defs>");
    for (const p of placed) {
      const cls = isHeritage ? "lbl-heritage" : "lbl-people";
      const tl = p.textLength ? ` textLength="${p.textLength.toFixed(0)}" lengthAdjust="spacing"` : "";
      parts.push(
        `<text class="${cls}" font-size="${p.fontPx.toFixed(1)}"><textPath href="#lp-${p.spec.id}" startOffset="50%"${tl}>${p.spec.text}</textPath></text>`,
      );
      if (p.showSub && p.spec.sub)
        parts.push(
          `<text class="lbl-sub" font-size="${Math.max(8, p.fontPx * 0.32).toFixed(1)}" transform="translate(0 ${(p.fontPx * 0.95).toFixed(1)})"><textPath href="#lp-${p.spec.id}" startOffset="50%">${p.spec.sub}</textPath></text>`,
        );
    }
    svg.innerHTML = parts.join("") + tagParts.join("");
    svg.classList.add("is-settled");
    dirty.current = false;
  };

  useEffect(() => { dirty.current = true; }, [peopleSpecs, heritageSpecs, layer, year, size, heightField]);

  useFrame(() => {
    const moved = !camera.matrixWorld.equals(lastMatrix.current);
    if (moved) {
      lastMatrix.current.copy(camera.matrixWorld);
      stillFrames.current = 0;
      dirty.current = true;
      svgRef.current?.classList.remove("is-settled");
      return;
    }
    if (stillFrames.current < SETTLE_FRAMES) {
      stillFrames.current++;
      if (stillFrames.current === SETTLE_FRAMES && dirty.current) relayout();
    } else if (dirty.current) relayout();
  });

  useEffect(() => {
    registerTestApi({
      labelStats: () => {
        const svg = svgRef.current;
        if (!svg) return { visible: 0, overlaps: 0, candidates: 0, eligible: 0 };
        // getBoundingClientRect misreports text-on-path in Chromium; measure
        // real glyph extents, skipping the empties it reports for some glyphs.
        const rects: { l: number; t: number; r: number; b: number }[] = [];
        svg.querySelectorAll("text.lbl-people, text.lbl-heritage").forEach(el => {
          const t = el as SVGTextElement;
          const n = t.getNumberOfChars();
          if (!n) return;
          let l = Infinity, tp = Infinity, r = -Infinity, bt = -Infinity;
          for (let i = 0; i < n; i++) {
            const e = t.getExtentOfChar(i);
            if (e.width === 0 && e.height === 0) continue;
            l = Math.min(l, e.x); tp = Math.min(tp, e.y);
            r = Math.max(r, e.x + e.width); bt = Math.max(bt, e.y + e.height);
          }
          const m = t.getScreenCTM();
          if (!m || !Number.isFinite(l)) return;
          const pts = [[l, tp], [r, tp], [l, bt], [r, bt]].map(([x, y]) => ({
            x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f,
          }));
          rects.push({
            l: Math.min(...pts.map(p => p.x)), t: Math.min(...pts.map(p => p.y)),
            r: Math.max(...pts.map(p => p.x)), b: Math.max(...pts.map(p => p.y)),
          });
        });
        let overlaps = 0;
        const inset = 1;
        for (let i = 0; i < rects.length; i++)
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i], b = rects[j];
            if (a.l + inset < b.r - inset && b.l + inset < a.r - inset &&
                a.t + inset < b.b - inset && b.t + inset < a.b - inset)
              overlaps++;
          }
        return {
          visible: rects.length, overlaps,
          candidates: lastCandidates.current, eligible: lastEligible.current,
        };
      },
    });
    const w = window as unknown as Record<string, unknown>;
    w.__poaSetLabelParams = (p: Partial<LayoutParams>) => { Object.assign(params.current, p); dirty.current = true; relayout(); };
    w.__poaForceLabels = () => { relayout(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peopleSpecs, heritageSpecs, layer, camera, size, heightField]);

  return null;
}
