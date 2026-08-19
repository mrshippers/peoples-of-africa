// The diorama: displaced Africa plate, depth-banded ocean, cinematic tilted
// camera, family drapes conforming to terrain. Replaces the v1 globe. Owns the
// window.__poa test API; UI talks only through the store.

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { familyColor } from "../data";
import type { PeopleFeature } from "../data";
import { buildFamilyMeshes, buildOutlines } from "./build";
import type { FamilyMeshData, ProjectFn } from "./build";
import { HeightField, PLATE, lonToX, latToZ, mapToWorld, buildTerrainGeometry } from "./terrain";
import { registerTestApi } from "./testApi";
import { useApp } from "../state";
import { attachPicking } from "./picking";
import { HeritageLayer } from "./HeritageLayer";
import { LabelLayer } from "./LabelLayer";
import { Highlight } from "./Highlight";
import { Ocean } from "./Ocean";
import { Vignettes } from "./Vignettes";

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 11;
const POLAR_MIN = 0.15, POLAR_MAX = 1.3;
const AZIMUTH = 1.35;
const BASE = import.meta.env.BASE_URL;

// Performance-sweep escape hatch: ?merge=group&count=N. Production runs the
// default per-family merge.
const SWEEP = new URLSearchParams(window.location.search);
const MERGE_STRATEGY = SWEEP.get("merge") === "group" ? "group" as const : "family" as const;
const GROUP_COUNT = Number(SWEEP.get("count")) || Infinity;

function useDrapeProject(hf: HeightField | null): ProjectFn | null {
  return useMemo(() => {
    if (!hf) return null;
    return (lon: number, lat: number) =>
      mapToWorld(lon, lat, Math.max(0, hf.worldY(lon, lat)) + 0.008);
  }, [hf]);
}

export function DioramaScene() {
  const peoples = useApp(s => s.peoples);
  const layer = useApp(s => s.layer);
  const heightField = useApp(s => s.heightField);
  const { gl, scene, camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const frameCounter = useRef({ count: 0, last: 0 });
  const profile = useRef<{ on: boolean; deltas: number[] }>({ on: false, deltas: [] });

  const project = useDrapeProject(heightField);

  const familyData: FamilyMeshData[] = useMemo(() => {
    if (!peoples || !project) return [];
    const slice = Number.isFinite(GROUP_COUNT) ? peoples.slice(0, GROUP_COUNT) : peoples;
    return buildFamilyMeshes(slice as PeopleFeature[], {
      project, strategy: MERGE_STRATEGY, maxEdgeDeg: 0.45,
    });
  }, [peoples, project]);

  const outlineGeometry = useMemo(
    () => (peoples && project ? buildOutlines(peoples, project) : null),
    [peoples, project],
  );

  const terrainGeometry = useMemo(
    () => (heightField ? buildTerrainGeometry(heightField) : null),
    [heightField],
  );

  // Progressive textures: low-res albedo immediately, 4K + normals streamed.
  const [albedo, setAlbedo] = useState<THREE.Texture | null>(null);
  const [normalMap, setNormalMap] = useState<THREE.Texture | null>(null);
  const heightTexture = useMemo(() => {
    const t = new THREE.TextureLoader().load(`${BASE}terrain/height.png`);
    t.colorSpace = THREE.NoColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    return t;
  }, []);
  // Stage 1: the small albedo, nothing else in flight.
  useEffect(() => {
    const lo = new THREE.TextureLoader().load(`${BASE}terrain/albedo_lo.jpg`, () => setAlbedo(lo));
    lo.colorSpace = THREE.SRGBColorSpace;
    lo.anisotropy = 8;
  }, []);

  // Stage 3: 4K albedo then normals, only once the plate is up.
  const baseReady = useApp(s => s.baseReady);
  useEffect(() => {
    if (!baseReady) return;
    const loader = new THREE.TextureLoader();
    const hi = loader.load(`${BASE}terrain/albedo.jpg`, () => {
      hi.colorSpace = THREE.SRGBColorSpace;
      hi.anisotropy = 8;
      setAlbedo(hi);
      const nm = loader.load(`${BASE}terrain/normal.jpg`, () => setNormalMap(nm));
    });
  }, [baseReady]);

  // The test API is registered on a coarse dep list, so anything it reports
  // must be read from a live ref — a captured value would report the state of
  // whichever render last re-registered it.
  const readyRef = useRef(false);
  const setBaseReady = useApp(s => s.setBaseReady);
  useEffect(() => {
    readyRef.current = Boolean(terrainGeometry && albedo);
    if (readyRef.current) setBaseReady();
  }, [terrainGeometry, albedo, setBaseReady]);

  // Picking over the drapes, unchanged mechanics.
  const groupRef = useRef<THREE.Group>(null);
  useEffect(() => {
    if (!familyData.length || !groupRef.current) return;
    return attachPicking(gl.domElement, camera, groupRef.current, familyData);
  }, [gl, camera, familyData]);

  useFrame(() => {
    frameCounter.current.count++;
    const now = performance.now();
    if (profile.current.on && frameCounter.current.last > 0)
      profile.current.deltas.push(now - frameCounter.current.last);
    frameCounter.current.last = now;
  });

  const clampTarget = (t: THREE.Vector3) => {
    t.x = Math.max(-PLATE.W / 2, Math.min(PLATE.W / 2, t.x));
    t.z = Math.max(-PLATE.H / 2, Math.min(PLATE.H / 2, t.z));
    t.y = Math.max(0, Math.min(0.5, t.y));
  };

  const syncCamera = (pos: THREE.Vector3, target?: THREE.Vector3) => {
    const c = controlsRef.current;
    if (target && c) { clampTarget(target); c.target.copy(target); }
    camera.position.copy(pos);
    if (c) {
      const damped = c.enableDamping;
      c.enableDamping = false;
      c.update();
      c.enableDamping = damped;
    }
    camera.updateMatrixWorld(true);
  };

  useEffect(() => {
    registerTestApi({
      ready: familyData.length > 0,
      audit: () => {
        let familyMeshCount = 0, totalMeshCount = 0, orphanedMeshes = 0;
        const familyNames: string[] = [];
        const activeLayer = useApp.getState().layer;
        scene.traverse(obj => {
          if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
            totalMeshCount++;
            const l = obj.userData.layer as string | undefined;
            if (obj.userData.family) { familyMeshCount++; familyNames.push(obj.userData.family); }
            if (l === "peoples" && obj.visible && activeLayer === "heritage") orphanedMeshes++;
            if (l === "heritage" && obj.visible && activeLayer === "peoples") orphanedMeshes++;
          }
        });
        return {
          familyMeshCount, familyNames, totalMeshCount, orphanedMeshes,
          drawCalls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
        };
      },
      setZoom: (distance: number) => {
        const c = controlsRef.current!;
        const offset = camera.position.clone().sub(c.target);
        const d = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, distance));
        syncCamera(c.target.clone().add(offset.normalize().multiplyScalar(d)));
        const actual = camera.position.distanceTo(c.target);
        const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(c.target));
        return { distance: actual, polar: sph.phi };
      },
      lookAt: (lat: number, lon: number) => {
        const c = controlsRef.current!;
        const offset = camera.position.clone().sub(c.target);
        const target = new THREE.Vector3(lonToX(lon), 0.05, latToZ(lat));
        syncCamera(target.clone().add(offset), target);
      },
      zoomLimits: () => ({ min: ZOOM_MIN, max: ZOOM_MAX }),
      cameraSane: () => {
        camera.updateMatrixWorld();
        if (camera.matrixWorld.elements.some(v => !Number.isFinite(v))) return false;
        const c = controlsRef.current!;
        const off = camera.position.clone().sub(c.target);
        const d = off.length();
        const sph = new THREE.Spherical().setFromVector3(off);
        return d >= ZOOM_MIN - 1e-6 && d <= ZOOM_MAX + 1e-6
          && sph.phi >= POLAR_MIN - 1e-6 && sph.phi <= POLAR_MAX + 1e-6
          && Math.abs(c.target.x) <= PLATE.W / 2 + 1e-6
          && Math.abs(c.target.z) <= PLATE.H / 2 + 1e-6;
      },
      setLayer: (l) => useApp.getState().setLayer(l),
      getLayer: () => useApp.getState().layer,
      setYear: (y) => useApp.getState().setYear(y),
      frameStats: () => ({ ...frameCounter.current }),
      // True once the plate itself is on screen — the honest "map is here".
      terrainReady: () => readyRef.current,
      profileStart: () => { profile.current.deltas = []; profile.current.on = true; },
      profileEnd: () => {
        profile.current.on = false;
        const d = [...profile.current.deltas].sort((a, b) => a - b);
        return {
          frames: d.length,
          meanMs: d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0,
          p95Ms: d.length ? d[Math.min(d.length - 1, Math.floor(d.length * 0.95))] : 0,
        };
      },
      select: (id) => useApp.getState().select(id),
      panelState: () => {
        const s = useApp.getState();
        return { open: s.selectedId != null, id: s.selectedId, populatedInMs: s.panelPopulatedInMs };
      },
    });
  }, [familyData, scene, gl, camera]);

  const peoplesVisible = layer === "peoples" || layer === "overlay";

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        makeDefault
        target={[0.15, 0.05, 0.55]}
        enablePan
        enableDamping
        dampingFactor={0.09}
        rotateSpeed={0.4}
        panSpeed={0.8}
        zoomSpeed={0.8}
        zoomToCursor
        minDistance={ZOOM_MIN}
        maxDistance={ZOOM_MAX}
        minPolarAngle={POLAR_MIN}
        maxPolarAngle={POLAR_MAX}
        minAzimuthAngle={-AZIMUTH}
        maxAzimuthAngle={AZIMUTH}
        onChange={() => {
          const c = controlsRef.current;
          if (c) clampTarget(c.target);
        }}
      />

      {/* Sun + fill: warm key from the north-west, generous sky fill - the
          reference is a sunny map, not a moody one. */}
      <directionalLight position={[-5.5, 7.2, -4.2]} intensity={2.5} color="#fff3dc" />
      <hemisphereLight args={["#cfe2f2", "#57503f", 1.15]} />

      {/* Diorama skirt: dark strata under the plate so its edge reads solid. */}
      <mesh position={[0, -0.21, 0]} userData={{ layer: "base" }}>
        <boxGeometry args={[PLATE.W, 0.26, PLATE.H]} />
        <meshStandardMaterial color="#141a20" roughness={1} />
      </mesh>

      {/* The plate */}
      {terrainGeometry && albedo && (
        <mesh geometry={terrainGeometry} userData={{ layer: "base" }} renderOrder={1}>
          <meshStandardMaterial
            map={albedo}
            normalMap={normalMap ?? undefined}
            normalScale={new THREE.Vector2(0.55, 0.55)}
            roughness={0.94}
            metalness={0}
          />
        </mesh>
      )}
      {terrainGeometry && <Ocean heightTexture={heightTexture} />}

      {/* Family ink washes + outlines, conforming to the terrain */}
      <group ref={groupRef}>
        {familyData.map((fd, i) => (
          <mesh
            key={`${fd.family}-${i}`}
            geometry={fd.geometry}
            userData={{ family: fd.family, layer: "peoples" }}
            visible={peoplesVisible}
            renderOrder={3}
          >
            <meshBasicMaterial
              color={familyColor.get(fd.family)}
              transparent
              opacity={layer === "overlay" ? 0.24 : 0.4}
              depthWrite={false}
            />
          </mesh>
        ))}
        {outlineGeometry && (
          <lineSegments geometry={outlineGeometry} userData={{ layer: "peoples" }}
            visible={peoplesVisible} renderOrder={4}>
            <lineBasicMaterial color="#1a2630" transparent opacity={0.4} />
          </lineSegments>
        )}
      </group>

      {familyData.length > 0 && <Highlight familyData={familyData} />}
      <HeritageLayer />
      <LabelLayer />
      <Vignettes />
    </>
  );
}

export function initialCameraPosition(): [number, number, number] {
  return [0.15, 5.9, 7.1];
}
