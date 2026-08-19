// Shell: full-bleed diorama, peripheral chrome. The height field loads first
// (the plate needs it); peoples/heritage stream in after first paint.

import { useEffect } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { DioramaScene, initialCameraPosition } from "./scene/DioramaScene";
import { HeightField } from "./scene/terrain";
import { loadPeoples, loadHeritage } from "./data";
import { useApp } from "./state";
import { Chrome } from "./ui/Chrome";

export default function App() {
  const setPeoples = useApp(s => s.setPeoples);
  const setHeritage = useApp(s => s.setHeritage);
  const setHeightField = useApp(s => s.setHeightField);

  useEffect(() => {
    let cancelled = false;
    // Strictly staged so the small tier is not starved of bandwidth by the
    // big one: low-res height first (the plate appears), then the full map,
    // then the data layers.
    // Stage 1: the small height tier, alone, so the plate appears fast.
    HeightField.load(`${import.meta.env.BASE_URL}terrain/height_lo.png`)
      .then(hf => { if (!cancelled) setHeightField(hf); })
      .catch(() => {});
    // Stages 2+: everything heavier waits until the plate is on screen.
    const unsub = useApp.subscribe((s: { baseReady: boolean }) => {
      if (!s.baseReady || cancelled) return;
      unsub();
      HeightField.load(`${import.meta.env.BASE_URL}terrain/height.png`)
        .then(hf => { if (!cancelled) setHeightField(hf); })
        .catch(() => {})
        .finally(() => {
          if (cancelled) return;
          loadPeoples().then(p => { if (!cancelled) setPeoples(p); });
          loadHeritage().then(h => { if (!cancelled) setHeritage(h); });
        });
    });
    return () => { cancelled = true; unsub(); };
  }, [setPeoples, setHeritage, setHeightField]);

  return (
    <div className="app">
      <Canvas
        className="globe-canvas"
        camera={{ position: initialCameraPosition(), fov: 36, near: 0.05, far: 60 }}
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.22;
        }}
      >
        <color attach="background" args={["#070b10"]} />
        <DioramaScene />
      </Canvas>
      <Chrome />
    </div>
  );
}
