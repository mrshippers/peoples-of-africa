// Scene layer: the globe, its drapes, camera constraints, and the test API.
// One module deep; UI talks to it only through the store.

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { FAMILIES, familyColor } from "../data";
import type { PeopleFeature } from "../data";
import { buildFamilyMeshes, buildOutlines, latLonToVec3, GLOBE_RADIUS } from "./build";
import type { FamilyMeshData } from "./build";
import { registerTestApi } from "./testApi";
import { useApp } from "../state";
import { attachPicking } from "./picking";
import { HeritageLayer } from "./HeritageLayer";
import { LabelLayer } from "./LabelLayer";
import { Highlight } from "./Highlight";

const AFRICA_CENTER = { lat: 2, lon: 17 };
export const ZOOM_MIN = 1.18;
export const ZOOM_MAX = 3.0;

// Muted printed-relief shader: desaturated Natural Earth tones with limb fade
// into the museum-dark surround. No lights; the map is the light source.
const reliefMaterial = (map: THREE.Texture) => new THREE.ShaderMaterial({
  uniforms: { map: { value: map } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vViewDir = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D map;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    void main() {
      vec3 c = texture2D(map, vUv).rgb;
      float luma = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 desat = mix(vec3(luma), c, 0.32);
      vec3 paper = desat * vec3(1.03, 1.0, 0.94) * 0.9;
      float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), 2.2);
      vec3 col = mix(paper, vec3(0.028, 0.028, 0.034), fresnel * 0.9);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});

function useFamilyData(peoples: PeopleFeature[] | null): FamilyMeshData[] {
  return useMemo(() => (peoples ? buildFamilyMeshes(peoples) : []), [peoples]);
}

export function GlobeScene() {
  const peoples = useApp(s => s.peoples);
  const layer = useApp(s => s.layer);
  const { gl, scene, camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const frameCounter = useRef({ count: 0, last: 0 });

  const familyData = useFamilyData(peoples);
  const outlineGeometry = useMemo(() => (peoples ? buildOutlines(peoples) : null), [peoples]);
  const texture = useMemo(() => {
    const t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/earth-relief.jpg`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, []);
  const sphereMaterial = useMemo(() => reliefMaterial(texture), [texture]);

  const peoplesVisible = layer === "peoples" || layer === "overlay";

  // Picking attaches to the canvas and resolves face -> group via ranges.
  useEffect(() => {
    if (!familyData.length || !groupRef.current) return;
    return attachPicking(gl.domElement, camera, groupRef.current, familyData);
  }, [gl, camera, familyData]);

  useFrame(() => { frameCounter.current.count++; frameCounter.current.last = performance.now(); });

  // Test API: everything the verify harness drives directly.
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
        const dir = camera.position.clone().normalize();
        camera.position.copy(dir.multiplyScalar(distance));
        c.update();
        const sph = new THREE.Spherical().setFromVector3(camera.position);
        return { distance: camera.position.length(), polar: sph.phi };
      },
      zoomLimits: () => ({ min: ZOOM_MIN, max: ZOOM_MAX }),
      cameraSane: () => {
        camera.updateMatrixWorld();
        const els = camera.matrixWorld.elements;
        if (els.some(v => !Number.isFinite(v))) return false;
        const sph = new THREE.Spherical().setFromVector3(camera.position);
        const c = controlsRef.current!;
        return sph.phi >= c.minPolarAngle - 1e-6 && sph.phi <= c.maxPolarAngle + 1e-6
          && camera.position.length() >= ZOOM_MIN - 1e-6
          && camera.position.length() <= ZOOM_MAX + 1e-6;
      },
      setLayer: (l) => useApp.getState().setLayer(l),
      getLayer: () => useApp.getState().layer,
      setYear: (y) => useApp.getState().setYear(y),
      frameStats: () => ({ ...frameCounter.current }),
      select: (id) => useApp.getState().select(id),
      panelState: () => {
        const s = useApp.getState();
        return { open: s.selectedId != null, id: s.selectedId, populatedInMs: s.panelPopulatedInMs };
      },
    });
  }, [familyData, scene, gl, camera]);

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.45}
        zoomSpeed={0.7}
        minDistance={ZOOM_MIN}
        maxDistance={ZOOM_MAX}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI - 0.35}
      />

      {/* Relief base */}
      <mesh material={sphereMaterial} userData={{ layer: "base" }}>
        <sphereGeometry args={[GLOBE_RADIUS, 96, 96]} />
      </mesh>

      {/* Family ink washes + outlines */}
      <group ref={groupRef}>
        {familyData.map(fd => (
          <mesh
            key={fd.family}
            geometry={fd.geometry}
            userData={{ family: fd.family, layer: "peoples" }}
            visible={peoplesVisible}
          >
            <meshBasicMaterial
              color={familyColor.get(fd.family)}
              transparent
              opacity={layer === "overlay" ? 0.32 : 0.52}
              depthWrite={false}
              side={THREE.FrontSide}
            />
          </mesh>
        ))}
        {outlineGeometry && (
          <lineSegments geometry={outlineGeometry} userData={{ layer: "peoples" }} visible={peoplesVisible}>
            <lineBasicMaterial color="#1c1a16" transparent opacity={0.35} />
          </lineSegments>
        )}
      </group>

      {familyData.length > 0 && <Highlight familyData={familyData} />}
      <HeritageLayer />
      <LabelLayer />
    </>
  );
}

export function initialCameraPosition(): [number, number, number] {
  const v = latLonToVec3(AFRICA_CENTER.lat, AFRICA_CENTER.lon, 2.35);
  return [v.x, v.y, v.z];
}

export { FAMILIES };
