// The water surface: a translucent plane over the baked seabed. Colour and
// opacity follow bathymetric depth (turquoise shelf, deep navy abyss), a foam
// ring hugs the waterline, and a faint ripple keeps the sun alive on it.

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { PLATE } from "./terrain";

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uHeight;   // packed metres: R hi, G lo, -11000 offset
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uCamPos;
  varying vec2 vUv;
  varying vec3 vWorld;

  float heightAt(vec2 uv) {
    vec3 t = texture2D(uHeight, uv).rgb;
    return (t.r * 255.0 * 256.0 + t.g * 255.0) - 11000.0;
  }

  void main() {
    float h = heightAt(vUv);
    float depth = max(0.0, -h);
    if (depth <= 0.5) discard;

    // depth-banded water colour over the baked seabed
    vec3 shallow = vec3(0.32, 0.82, 0.80);
    vec3 mid     = vec3(0.07, 0.44, 0.62);
    vec3 deep    = vec3(0.03, 0.19, 0.38);
    float t1 = smoothstep(0.0, 60.0, depth);
    float t2 = smoothstep(60.0, 2200.0, depth);
    vec3 col = mix(shallow, mid, t1);
    col = mix(col, deep, t2);

    float alpha = mix(0.16, 0.66, smoothstep(0.0, 500.0, depth));

    // ripple: two scrolling sine fields perturb the normal for sun glint
    vec2 p = vWorld.xz * 40.0;
    float r = sin(p.x * 1.7 + uTime * 0.9) * sin(p.y * 1.3 - uTime * 0.7)
            + 0.5 * sin(p.x * 3.9 - uTime * 1.3) * sin(p.y * 2.9 + uTime * 1.1);
    vec3 n = normalize(vec3(r * 0.015, 1.0, r * 0.012));

    vec3 viewDir = normalize(uCamPos - vWorld);
    vec3 hv = normalize(viewDir + normalize(uSunDir));
    float spec = pow(max(dot(n, hv), 0.0), 240.0) * 0.55;
    float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0) * 0.22;
    col += spec + fres * vec3(0.55, 0.75, 0.85);

    // foam ring at the waterline
    float foamBand = 1.0 - smoothstep(1.0, 7.0, depth);
    float foamN = sin(p.x * 6.0 + uTime * 1.7) * sin(p.y * 5.0 - uTime * 1.9);
    float foam = foamBand * smoothstep(0.15, 0.75, foamN * 0.5 + 0.5) * 0.8;
    col = mix(col, vec3(0.96, 0.98, 0.97), foam);
    alpha = max(alpha, foam * 0.85);

    gl_FragColor = vec4(col, alpha);
  }
`;

export function Ocean({ heightTexture }: { heightTexture: THREE.Texture }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uHeight: { value: heightTexture },
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(-0.55, 0.72, -0.42) },
      uCamPos: { value: new THREE.Vector3() },
    },
    transparent: true,
    depthWrite: false,
  }), [heightTexture]);

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uCamPos.value.copy(state.camera.position);
  });

  return (
    <mesh material={material} ref={() => void matRef} position={[0, 0.0005, 0]}
      rotation={[-Math.PI / 2, 0, 0]} userData={{ layer: "base" }} renderOrder={2}>
      <planeGeometry args={[PLATE.W, PLATE.H, 1, 1]} />
    </mesh>
  );
}
