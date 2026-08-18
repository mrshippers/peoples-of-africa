// UI layer: everything that is not the globe. Peripheral, recedes.
// System 3 adds the editorial card; system 4 the layer toggle + scrubber.

import { FAMILIES } from "../data";
import { useApp } from "../state";
import { DetailCard } from "./DetailCard";
import { LayerControl } from "./LayerControl";
import { Timeline } from "./Timeline";

export function Chrome() {
  const peoples = useApp(s => s.peoples);
  const layer = useApp(s => s.layer);

  return (
    <>
      <header className="masthead">
        <h1>{layer === "heritage" ? "The Heritage of Africa" : "The Peoples of Africa"}</h1>
        <p className="masthead-sub">
          {layer === "heritage"
            ? "States and kingdoms of the African past"
            : "Ethnolinguistic map · after the 1971 National Geographic pair"}
        </p>
      </header>

      <LayerControl />
      <Timeline />

      <aside className="legend" aria-label="Language family key" hidden={layer === "heritage"}>
        {FAMILIES.map(f => (
          <div className="legend-row" key={f.name}>
            <span className="legend-swatch" style={{ background: f.color }} />
            <span className="legend-name">{f.name}</span>
          </div>
        ))}
        <p className="legend-credit">
          Boundaries: Murdock (1959), digitized N. Nunn · Families: Glottolog · Base: Natural Earth
        </p>
      </aside>

      {!peoples && <div className="loading" role="status">Drawing the map…</div>}

      <DetailCard />
    </>
  );
}
