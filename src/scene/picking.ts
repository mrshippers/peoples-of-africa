// Picking layer: raycast against the merged family meshes and resolve the hit
// face to a group via the contiguous triangle ranges. Registers pickAt on the
// test API so the harness can drive it without synthetic pointer events.

import * as THREE from "three";
import type { FamilyMeshData, GroupRange } from "./build";
import { registerTestApi } from "./testApi";
import type { PickResult } from "./testApi";
import { useApp } from "../state";
import { mapToWorld } from "./terrain";

function rangeFor(ranges: GroupRange[], faceIndex: number): GroupRange | null {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid];
    if (faceIndex < r.triStart) hi = mid - 1;
    else if (faceIndex >= r.triStart + r.triCount) lo = mid + 1;
    else return r;
  }
  return null;
}

export function attachPicking(
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  root: THREE.Object3D,
  familyData: FamilyMeshData[],
): () => void {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const byGeometry = new Map<THREE.BufferGeometry, FamilyMeshData>();
  for (const fd of familyData) byGeometry.set(fd.geometry, fd);

  const meshes: THREE.Mesh[] = [];
  root.traverse(o => {
    if (o instanceof THREE.Mesh && byGeometry.has(o.geometry as THREE.BufferGeometry)) meshes.push(o);
  });

  const nameOf = new Map<string, { name: string; family: string }>();
  for (const f of useApp.getState().peoples ?? [])
    nameOf.set(f.properties.id, { name: f.properties.name, family: f.properties.family });

  function pick(ndcX: number, ndcY: number): PickResult | null {
    if (useApp.getState().layer === "heritage") return null;
    pointer.set(ndcX, ndcY);
    raycaster.setFromCamera(pointer, camera);
    const visibleMeshes = meshes.filter(m => m.visible);
    const hits = raycaster.intersectObjects(visibleMeshes, false);
    const hit = hits[0];
    if (!hit || hit.faceIndex == null) return null;
    const fd = byGeometry.get((hit.object as THREE.Mesh).geometry as THREE.BufferGeometry);
    if (!fd) return null;
    const range = rangeFor(fd.ranges, hit.faceIndex);
    if (!range) return null;
    const meta = nameOf.get(range.id);
    return { id: range.id, name: meta?.name ?? range.id, family: meta?.family ?? fd.family };
  }

  const toNdc = (e: PointerEvent | MouseEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    ];
  };

  let rafPending = false;
  let lastEvent: PointerEvent | null = null;
  const onMove = (e: PointerEvent) => {
    lastEvent = e;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!lastEvent) return;
      const [x, y] = toNdc(lastEvent);
      const result = pick(x, y);
      useApp.getState().setHover(result?.id ?? null);
      canvas.style.cursor = result ? "pointer" : "grab";
    });
  };

  let downAt: [number, number] | null = null;
  const onDown = (e: PointerEvent) => { downAt = [e.clientX, e.clientY]; };
  const onUp = (e: PointerEvent) => {
    // A drag is an orbit, not a pick.
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    if (moved > 4) return;
    const [x, y] = toNdc(e);
    const result = pick(x, y);
    const s = useApp.getState();
    s.select(result && result.id !== s.selectedId ? result.id : null);
  };

  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);

  registerTestApi({
    pickAt: (x, y) => pick(x, y),
    // Pick at the screen position a map point projects to. On a tilted plate
    // the view centre is not the look-at point, so centre-screen picking would
    // test the wrong pixel.
    pickAtLonLat: (lon: number, lat: number) => {
      const hf = useApp.getState().heightField;
      if (!hf) return null;
      const world = mapToWorld(lon, lat, Math.max(0, hf.worldY(lon, lat)) + 0.008);
      const ndc = world.clone().project(camera);
      if (ndc.z > 1 || ndc.z < -1) return null;
      return pick(ndc.x, ndc.y);
    },
  });

  return () => {
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointerup", onUp);
  };
}
