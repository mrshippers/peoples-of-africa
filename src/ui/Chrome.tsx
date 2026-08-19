// UI layer: everything that is not the globe. Peripheral, recedes.
// System 3 adds the editorial card; system 4 the layer toggle + scrubber.

import { useEffect, useState } from "react";
import { FAMILIES } from "../data";
import { useApp } from "../state";
import { DetailCard } from "./DetailCard";
import { LayerControl } from "./LayerControl";
import { Timeline } from "./Timeline";

interface Credit { title: string; author: string; license: string }

export function Chrome() {
  const peoples = useApp(s => s.peoples);
  const layer = useApp(s => s.layer);
  const [credits, setCredits] = useState<Record<string, Credit> | null>(null);

  // Behind the same gate as every other non-essential fetch: attribution must
  // not compete with the plate for first-paint bandwidth.
  const baseReady = useApp(s => s.baseReady);
  useEffect(() => {
    if (!baseReady) return;
    fetch(`${import.meta.env.BASE_URL}models/credits.json`)
      .then(r => r.json()).then(setCredits).catch(() => {});
  }, [baseReady]);

  const modelAuthors = credits
    ? [...new Set(Object.values(credits).map(c => `${c.author} (${c.license})`))].sort()
    : [];

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
          Boundaries: Murdock (1959), digitized N. Nunn · Families: Glottolog ·
          Base: Natural Earth II · Relief: AWS Terrain Tiles (Mapzen)
          {modelAuthors.length > 0 && <> · Models: {modelAuthors.join(", ")}</>}
        </p>
      </aside>

      {!peoples && <div className="loading" role="status">Drawing the map…</div>}

      <DetailCard />
    </>
  );
}
