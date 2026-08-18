// Cartographic typography layer. One SVG overlay; labels are laid out when the
// camera settles and fade away while it moves - the map composes itself when
// you stop to read it. Serif caps for peoples, small caps for polities, mono
// micro-labels for metadata.

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useApp } from "../state";
import { computeLabelSpec, layoutLabels, DEFAULT_PARAMS } from "./labels";
import type { LabelSpec, LayoutParams, PlacedLabel } from "./labels";
import { registerTestApi } from "./testApi";
import type { PeopleFeature } from "../data";

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
  const layer = useApp(s => s.layer);
  const year = useApp(s => s.year);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const params = useRef<LayoutParams>({ ...DEFAULT_PARAMS });
  const lastMatrix = useRef(new THREE.Matrix4());
  const stillFrames = useRef(0);
  const dirty = useRef(true);
  const lastPlaced = useRef<PlacedLabel[]>([]);
  const lastCandidates = useRef(0);

  const peopleSpecs = useMemo(
    () => (peoples ? peoples.map(computeLabelSpec) : []),
    [peoples],
  );
  const heritageSpecs = useMemo(
    () => (heritage ? politySpecs(heritage.polities) : []),
    [heritage],
  );

  // The overlay element lives beside the canvas, pointer-transparent.
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
    if (!svg) return;
    // Heritage sub-labels are the polity dates - worth showing at smaller type
    // than the peoples' language micro-labels.
    const effParams = layer === "peoples"
      ? params.current
      : { ...params.current, subMinFontPx: 12 };
    const { placed, candidates } = layoutLabels(activeSpecs(), camera, size.width, size.height, effParams);
    lastPlaced.current = placed;
    lastCandidates.current = candidates;
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
    svg.innerHTML = parts.join("");
    svg.classList.add("is-settled");
    dirty.current = false;
  };

  // Layer, year, or data changes invalidate the layout.
  useEffect(() => { dirty.current = true; }, [peopleSpecs, heritageSpecs, layer, year, size]);

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
        if (!svg) return { visible: 0, overlaps: 0, candidates: 0 };
        // getBoundingClientRect misreports text-on-path in Chromium (boxes
        // anchor at the origin); measure real glyph extents instead.
        const rects: { l: number; t: number; r: number; b: number }[] = [];
        svg.querySelectorAll("text.lbl-people, text.lbl-heritage").forEach(el => {
          const t = el as SVGTextElement;
          const n = t.getNumberOfChars();
          if (!n) return;
          let l = Infinity, tp = Infinity, r = -Infinity, bt = -Infinity;
          for (let i = 0; i < n; i++) {
            const e = t.getExtentOfChar(i);
            if (e.width === 0 && e.height === 0) continue; // Chromium reports some path glyphs empty
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
        return { visible: rects.length, overlaps, candidates: lastCandidates.current };
      },
    });
    const w = window as unknown as Record<string, unknown>;
    w.__poaSetLabelParams = (p: Partial<LayoutParams>) => { Object.assign(params.current, p); dirty.current = true; relayout(); };
    w.__poaForceLabels = () => { relayout(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peopleSpecs, heritageSpecs, layer, camera, size]);

  return null;
}
