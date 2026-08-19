// Story vignettes: low-poly CC0/CC-BY models pinned to real places, plus two
// procedural set-pieces (Giza pyramids, Malagasy baobabs). Deliberately
// oversized, like the miniatures on a game map. Tags render in LabelLayer.

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import { mapToWorld } from "./terrain";
import { useApp } from "../state";
import { registerTestApi } from "./testApi";
import type { VignetteDef } from "../state";

const BASE = import.meta.env.BASE_URL;

function normalized(scene: THREE.Object3D, targetHeight: number): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const s = targetHeight / Math.max(1e-6, size.y);
  const root = new THREE.Group();
  scene.scale.setScalar(s);
  // sit on the ground: lift so the bbox bottom lands at y=0
  scene.position.y = -box.min.y * s;
  scene.position.x = -(box.min.x + size.x / 2) * s;
  scene.position.z = -(box.min.z + size.z / 2) * s;
  root.add(scene);
  return root;
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

export function Vignettes() {
  const heightField = useApp(s => s.heightField);
  const vignettes = useApp(s => s.vignettes);
  const setVignettes = useApp(s => s.setVignettes);
  const [models, setModels] = useState<Map<string, THREE.Object3D>>(new Map());

  useEffect(() => {
    fetch(`${BASE}data/vignettes.json`)
      .then(r => r.json())
      .then((v: VignetteDef[]) => setVignettes(v));
  }, [setVignettes]);

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
      vignetteAudit: () => (vignettes.map(v => {
        const h = heightField.sample(v.lon, v.lat);
        const terrainOk = v.needs === "water" ? h < 0 : h >= 0;
        const inBbox = v.lon >= v.bbox[0] && v.lat >= v.bbox[1] && v.lon <= v.bbox[2] && v.lat <= v.bbox[3];
        const hasModel = v.model.startsWith("@") || models.has(v.model);
        return { id: v.id, inBbox, terrainOk, hasModel };
      })),
    } as never);
  }, [vignettes, heightField, models]);

  return (
    <group>
      {placed.map(({ v, pos, object }) => object && (
        <primitive key={v.id} object={object} position={pos}
          rotation={[0, v.rotY, 0]} userData={{ layer: "vignette" }} />
      ))}
    </group>
  );
}
