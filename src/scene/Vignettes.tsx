// Story vignettes: low-poly CC0/CC-BY models pinned to real places, plus two
// procedural set-pieces (Giza pyramids, Malagasy baobabs). Deliberately
// oversized, like the miniatures on a game map. Tags render in LabelLayer.

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import { useFrame } from "@react-three/fiber";
import { mapToWorld } from "./terrain";
import { useApp } from "../state";
import { registerTestApi } from "./testApi";
import { vignetteRegionMap } from "./vignetteRegions";
import type { VignetteDef } from "../state";

const BASE = import.meta.env.BASE_URL;

/** Bounds from raw geometry — Box3.setFromObject measures SkinnedMesh via the
 *  skeleton, which reports nonsense for these packs (a zebra the size of the
 *  Congo). Geometry boxes transformed by world matrices are deterministic. */
function measure(obj: THREE.Object3D): THREE.Box3 {
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  obj.traverse(o => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!g?.attributes?.position) return;
    if (!g.boundingBox) g.computeBoundingBox();
    if (g.boundingBox) box.union(g.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return box;
}

/** Replace SkinnedMesh with a plain Mesh of the same bind-pose geometry.
 *  These packs ship rigs whose bone transforms scale the rendered result far
 *  beyond the geometry — the zebra rendered the size of the Congo while its
 *  bounding box measured centimetres. We only ever draw a static pose. */
function deskin(root: THREE.Object3D): THREE.Object3D {
  const swaps: [THREE.Object3D, THREE.Object3D][] = [];
  root.traverse(o => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
      const sm = o as THREE.SkinnedMesh;
      const m = new THREE.Mesh(sm.geometry, sm.material);
      m.position.copy(sm.position);
      m.quaternion.copy(sm.quaternion);
      m.scale.copy(sm.scale);
      swaps.push([sm, m]);
    }
  });
  for (const [old, next] of swaps) {
    const parent = old.parent;
    if (parent) { parent.remove(old); parent.add(next); }
  }
  // Bones left behind carry no geometry; drop them so nothing scales the pose.
  const bones: THREE.Object3D[] = [];
  root.traverse(o => { if ((o as THREE.Bone).isBone) bones.push(o); });
  for (const b of bones) b.parent?.remove(b);
  return root;
}

function normalized(scene: THREE.Object3D, targetHeight: number): THREE.Object3D {
  // Scale a WRAPPER, never the model root: several of these GLBs carry their
  // own root scale, and overwriting it made them continent-sized.
  const inner = new THREE.Group();
  inner.add(deskin(scene));
  const box = measure(inner);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (!Number.isFinite(size.y) || size.y <= 1e-6) return new THREE.Group();
  const s = targetHeight / size.y;
  inner.scale.setScalar(s);
  inner.position.set(
    -(box.min.x + size.x / 2) * s,
    -box.min.y * s,
    -(box.min.z + size.z / 2) * s,
  );
  const outer = new THREE.Group();
  outer.add(inner);
  return outer;
}

function pyramids(scale: number): THREE.Object3D {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: "#d9bd8a", roughness: 0.95, flatShading: true });
  const sizes = [1.0, 0.78, 0.5];
  const offsets: [number, number][] = [[0, 0], [1.15, 0.55], [2.05, 1.25]];
  sizes.forEach((s, i) => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.72 * s, s, 4), stone);
    cone.position.set(offsets[i][0], s / 2, offsets[i][1]);
    cone.rotation.y = Math.PI / 4;
    g.add(cone);
  });
  g.scale.setScalar(scale);
  return g;
}

function baobabs(scale: number): THREE.Object3D {
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: "#9a6a4c", roughness: 0.9, flatShading: true });
  const leafMat = new THREE.MeshStandardMaterial({ color: "#5d7d43", roughness: 0.9, flatShading: true });
  const spots: [number, number, number][] = [[0, 0, 1], [0.9, 0.35, 0.8], [-0.8, 0.5, 0.9], [0.35, 1.05, 0.7], [-0.4, -0.6, 0.75]];
  for (const [x, z, s] of spots) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.26 * s, s, 7), trunkMat);
    trunk.position.set(x, s / 2, z);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.34 * s, 6, 4), leafMat);
    crown.position.set(x, s * 1.08, z);
    crown.scale.y = 0.45;
    g.add(trunk, crown);
  }
  g.scale.setScalar(scale);
  return g;
}

/** Ease a freshly revealed vignette up from small; unmount is instant. */
function Pop({ position, children }: { position: THREE.Vector3; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.scale.setScalar(Math.min(1, g.scale.x + (1 - g.scale.x) * 0.22 + 0.001));
  });
  return <group ref={ref} position={position} scale={0.05}>{children}</group>;
}

export function Vignettes() {
  const heightField = useApp(s => s.heightField);
  const vignettes = useApp(s => s.vignettes);
  const setVignettes = useApp(s => s.setVignettes);
  const peoples = useApp(s => s.peoples);
  const hoverId = useApp(s => s.hoverId);
  const selectedId = useApp(s => s.selectedId);
  const [models, setModels] = useState<Map<string, THREE.Object3D>>(new Map());

  // Models are the last thing to stream: they must not compete with the plate.
  const baseReady = useApp(s => s.baseReady);
  useEffect(() => {
    if (!baseReady) return;
    fetch(`${BASE}data/vignettes.json`)
      .then(r => r.json())
      .then((v: VignetteDef[]) => setVignettes(v));
  }, [setVignettes, baseReady]);

  useEffect(() => {
    if (!vignettes) return;
    const loader = new GLTFLoader();
    let cancelled = false;
    const names = [...new Set(vignettes.map(v => v.model).filter(m => !m.startsWith("@")))];
    for (const name of names) {
      loader.load(`${BASE}models/${name}.glb`, gltf => {
        if (cancelled) return;
        setModels(prev => new Map(prev).set(name, gltf.scene));
      }, undefined, () => { /* model missing: tag still renders */ });
    }
    return () => { cancelled = true; };
  }, [vignettes]);

  const placed = useMemo(() => {
    if (!vignettes || !heightField) return [];
    return vignettes.map(v => {
      const ground = v.needs === "water" ? 0.002 : Math.max(0, heightField.worldY(v.lon, v.lat)) + 0.002;
      const pos = mapToWorld(v.lon, v.lat, ground);
      let object: THREE.Object3D | null = null;
      if (v.model === "@pyramids") object = pyramids(v.scale);
      else if (v.model === "@baobabs") object = baobabs(v.scale);
      else if (v.model !== "@marker") {
        const m = models.get(v.model);
        if (m) object = normalized(m.clone(true), v.scale);
      }
      return { v, pos, object };
    });
  }, [vignettes, heightField, models]);

  useEffect(() => {
    if (!vignettes || !heightField) return;
    registerTestApi({
      vignetteSizes: () => placed.map(({ v, object }) => {
        if (!object) return { id: v.id, size: null };
        const b = measure(object);
        const sz = new THREE.Vector3(); b.getSize(sz);
        return { id: v.id, size: [+sz.x.toFixed(3), +sz.y.toFixed(3), +sz.z.toFixed(3)] };
      }),
      vignetteAudit: () => (vignettes.map(v => {
        const h = heightField.sample(v.lon, v.lat);
        const terrainOk = v.needs === "water" ? h < 0 : h >= 0;
        const inBbox = v.lon >= v.bbox[0] && v.lat >= v.bbox[1] && v.lon <= v.bbox[2] && v.lat <= v.bbox[3];
        const hasModel = v.model.startsWith("@") || models.has(v.model);
        return { id: v.id, inBbox, terrainOk, hasModel };
      })),
    } as never);
  }, [vignettes, heightField, models]);

  // Vignettes reveal on hover: only the hovered (or selected) region's
  // miniatures render, so the plate reads as cartography until you explore.
  const regionOf = useMemo(
    () => (peoples && vignettes ? vignetteRegionMap(peoples, vignettes) : null),
    [peoples, vignettes],
  );

  return (
    <group>
      {placed.map(({ v, pos, object }) => {
        if (!object) return null;
        const owners = regionOf?.get(v.id);
        const shown = owners != null && ((hoverId != null && owners.has(hoverId))
          || (selectedId != null && owners.has(selectedId)));
        if (!shown) return null;
        return (
          <Pop key={v.id} position={pos}>
            <primitive object={object}
              rotation={[0, v.rotY, 0]} userData={{ layer: "vignette" }} />
          </Pop>
        );
      })}
    </group>
  );
}
