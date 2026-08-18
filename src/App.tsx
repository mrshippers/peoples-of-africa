// Shell: full-bleed globe, peripheral chrome. Data loads after first paint.

import { useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { GlobeScene, initialCameraPosition } from "./scene/GlobeScene";
import { loadPeoples, loadHeritage } from "./data";
import { useApp } from "./state";
import { Chrome } from "./ui/Chrome";

export default function App() {
  const setPeoples = useApp(s => s.setPeoples);
  const setHeritage = useApp(s => s.setHeritage);

  useEffect(() => {
    let cancelled = false;
    // Lazy: first paint happens with the bare sphere; data streams in after.
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1));
    idle(() => {
      loadPeoples().then(p => { if (!cancelled) setPeoples(p); });
      loadHeritage().then(h => { if (!cancelled) setHeritage(h); });
    });
    return () => { cancelled = true; };
  }, [setPeoples, setHeritage]);

  return (
    <div className="app">
      <Canvas
        className="globe-canvas"
        camera={{ position: initialCameraPosition(), fov: 40, near: 0.01, far: 20 }}
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#0a0a0c"]} />
        <GlobeScene />
      </Canvas>
      <Chrome />
    </div>
  );
}
