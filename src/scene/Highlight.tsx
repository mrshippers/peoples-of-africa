// Hover + selection emphasis. Shares the family mesh position buffers and
// draws only the group's triangle range - no geometry copies. Feedback
// animation: opacity ease-in within the 180ms purpose-test window.

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { FamilyMeshData } from "./build";
import { useApp } from "../state";

const FADE_MS = 140;

interface Slot { geometry: THREE.BufferGeometry; material: THREE.MeshBasicMaterial }

export function Highlight({ familyData }: { familyData: FamilyMeshData[] }) {
  const hoverId = useApp(s => s.hoverId);
  const selectedId = useApp(s => s.selectedId);

  const lookup = useMemo(() => {
    const m = new Map<string, { fd: FamilyMeshData; triStart: number; triCount: number }>();
    for (const fd of familyData)
      for (const r of fd.ranges) m.set(r.id, { fd, triStart: r.triStart, triCount: r.triCount });
    return m;
  }, [familyData]);

  const hoverSlot = useRef<Slot | null>(null);
  const selectSlot = useRef<Slot | null>(null);
  const hoverStart = useRef(0);

  const slots = useMemo(() => {
    const make = (): Slot => ({
      geometry: new THREE.BufferGeometry(),
      material: new THREE.MeshBasicMaterial({
        color: "#F2E8D5", transparent: true, opacity: 0, depthWrite: false,
      }),
    });
    hoverSlot.current = make();
    selectSlot.current = make();
    return [hoverSlot.current, selectSlot.current];
  }, []);

  useMemo(() => {
    const apply = (slot: Slot | null, id: string | null) => {
      if (!slot) return;
      const entry = id ? lookup.get(id) : null;
      if (!entry) { slot.geometry.setDrawRange(0, 0); return; }
      const attr = entry.fd.geometry.getAttribute("position");
      if (slot.geometry.getAttribute("position") !== attr)
        slot.geometry.setAttribute("position", attr);
      slot.geometry.setDrawRange(entry.triStart * 3, entry.triCount * 3);
      slot.geometry.computeBoundingSphere();
    };
    apply(hoverSlot.current, hoverId);
    apply(selectSlot.current, selectedId);
    hoverStart.current = performance.now();
  }, [hoverId, selectedId, lookup]);

  useFrame(() => {
    const t = Math.min(1, (performance.now() - hoverStart.current) / FADE_MS);
    if (hoverSlot.current) {
      const target = hoverId && hoverId !== selectedId ? 0.22 : 0;
      hoverSlot.current.material.opacity += (target * t - hoverSlot.current.material.opacity) * 0.5;
    }
    if (selectSlot.current)
      selectSlot.current.material.opacity = selectedId ? 0.3 : 0;
  });

  return (
    <>
      {slots.map((s, i) => (
        <mesh key={i} geometry={s.geometry} material={s.material}
          userData={{ layer: "peoples" }} renderOrder={5} />
      ))}
    </>
  );
}
