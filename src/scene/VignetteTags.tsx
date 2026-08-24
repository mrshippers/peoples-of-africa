// Hover-reveal vignette tags: leader line, dot and box for the vignettes of
// the hovered (or selected) region only. Lives in its own overlay so a tag
// appearing never re-runs the cartographic label layout.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useApp } from "../state";
import { vignetteRegionMap } from "./vignetteRegions";
import { mapToWorld } from "./terrain";

export function VignetteTags() {
  const { camera, gl, size } = useThree();
  const heightField = useApp(s => s.heightField);
  const vignettes = useApp(s => s.vignettes);
  const peoples = useApp(s => s.peoples);
  const hoverId = useApp(s => s.hoverId);
  const selectedId = useApp(s => s.selectedId);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "labels-overlay is-settled");
    svg.setAttribute("aria-hidden", "true");
    gl.domElement.parentElement?.appendChild(svg);
    svgRef.current = svg;
    return () => svg.remove();
  }, [gl]);

  const regionOf = useMemo(
    () => (peoples && vignettes ? vignetteRegionMap(peoples, vignettes) : null),
    [peoples, vignettes],
  );

  const active = useMemo(() => {
    if (!vignettes || !regionOf) return [];
    return vignettes.filter(v => {
      const owners = regionOf.get(v.id);
      return owners != null && ((hoverId != null && owners.has(hoverId))
        || (selectedId != null && owners.has(selectedId)));
    });
  }, [vignettes, regionOf, hoverId, selectedId]);

  useFrame(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (!active.length || !heightField) {
      if (svg.innerHTML) svg.innerHTML = "";
      return;
    }
    const parts: string[] = [];
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    for (const v of active) {
      const world = mapToWorld(v.lon, v.lat, Math.max(0, heightField.worldY(v.lon, v.lat)) + 0.02);
      const ndc = world.project(camera);
      if (ndc.z > 1 || ndc.z < -1) continue;
      const p = { x: (ndc.x + 1) / 2 * size.width, y: (1 - ndc.y) / 2 * size.height };
      if (p.x < 20 || p.x > size.width - 20 || p.y < 30 || p.y > size.height - 20) continue;
      const wMain = v.label.length * 6.4 + 18;
      const wSub = v.sub.length * 5.0 + 18;
      const w = Math.max(wMain, wSub);
      const h = 30;
      let bx = Math.min(p.x + 16, size.width - w - 10);
      let by = Math.max(10, p.y - 40);
      const hits = (x: number, y: number) => rects.some(t =>
        x < t.x + t.w + 4 && t.x < x + w + 4 && y < t.y + t.h + 4 && t.y < y + h + 4);
      for (let tries = 0; tries < 5 && hits(bx, by); tries++) by -= h + 12;
      rects.push({ x: bx - 4, y: by - 4, w: w + 8, h: h + 8 });
      parts.push(
        `<line class="tag-lead" x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${(by + h).toFixed(1)}"/>`,
        `<circle class="tag-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.4"/>`,
        `<rect class="tag-box" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${w.toFixed(0)}" height="${h}"/>`,
        `<text class="tag-title" x="${(bx + 9).toFixed(1)}" y="${(by + 13).toFixed(1)}">${v.label}</text>`,
        `<text class="tag-sub" x="${(bx + 9).toFixed(1)}" y="${(by + 24).toFixed(1)}">${v.sub}</text>`,
      );
    }
    svg.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
    svg.setAttribute("width", String(size.width));
    svg.setAttribute("height", String(size.height));
    svg.innerHTML = parts.join("");
  });

  return null;
}
