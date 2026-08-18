// Layer switch: peoples / heritage / overlay. Rectilinear text controls,
// letterspaced small caps - no pills.

import { useApp } from "../state";
import type { Layer } from "../state";

const LAYERS: { key: Layer; label: string }[] = [
  { key: "peoples", label: "Peoples" },
  { key: "heritage", label: "Heritage" },
  { key: "overlay", label: "Overlay" },
];

export function LayerControl() {
  const layer = useApp(s => s.layer);
  const setLayer = useApp(s => s.setLayer);

  return (
    <nav className="layers" aria-label="Map layer">
      {LAYERS.map(l => (
        <button
          key={l.key}
          className={`layers-btn ${layer === l.key ? "is-active" : ""}`}
          aria-pressed={layer === l.key}
          onClick={() => setLayer(l.key)}
        >
          {l.label}
        </button>
      ))}
    </nav>
  );
}
