// The editorial side card. Always enters and exits stage right; reads as a
// magazine column, not a dashboard. Populated synchronously from the store -
// the harness measures open -> populated.

import { useEffect, useMemo } from "react";
import { familyColor } from "../data";
import { useApp } from "../state";

export function DetailCard() {
  const selectedId = useApp(s => s.selectedId);
  const peoples = useApp(s => s.peoples);
  const heritage = useApp(s => s.heritage);
  const layer = useApp(s => s.layer);
  const select = useApp(s => s.select);
  const markPanelPopulated = useApp(s => s.markPanelPopulated);

  const people = useMemo(
    () => peoples?.find(f => f.properties.id === selectedId) ?? null,
    [peoples, selectedId],
  );
  const polity = useMemo(
    () => heritage?.polities.find(p => p.id === selectedId) ?? null,
    [heritage, selectedId],
  );

  useEffect(() => {
    if (people || polity) markPanelPopulated();
  }, [people, polity, markPanelPopulated]);

  const open = Boolean(people || polity);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") select(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  if (!open) return null;

  return (
    <article className={`card ${layer === "heritage" ? "card-heritage" : ""}`} aria-live="polite">
      <button className="card-close" onClick={() => select(null)} aria-label="Close">×</button>
      {people && (
        <>
          <div className="card-kicker" style={{ color: familyColor.get(people.properties.family) }}>
            {people.properties.family}
          </div>
          <h2 className="card-title">{people.properties.name}</h2>
          <hr className="card-rule" />
          <dl className="card-meta">
            {people.properties.language && (
              <><dt>Language</dt><dd>{people.properties.language}</dd></>
            )}
            {people.properties.group && (
              <><dt>Culture group</dt><dd>{people.properties.group}</dd></>
            )}
            <dt>Centre</dt>
            <dd>{Math.abs(people.properties.lat).toFixed(1)}°{people.properties.lat >= 0 ? "N" : "S"}, {Math.abs(people.properties.lon).toFixed(1)}°{people.properties.lon >= 0 ? "E" : "W"}</dd>
          </dl>
          <p className="card-body">
            One of the {peoples!.length} peoples mapped from Murdock's 1959 survey of the
            continent, classified here to the {people.properties.family} family
            {people.properties.language ? ` through the ${people.properties.language} language` : ""}.
            Territory shows the group's extent as recorded in the mid-twentieth century,
            not a modern political boundary.
          </p>
          <footer className="card-sources">
            {people.properties.ea && <span>Ethnographic Atlas {people.properties.ea} · </span>}
            {people.properties.glottocode && <span>Glottolog {people.properties.glottocode} · </span>}
            <span>Murdock (1959), digitized Nunn</span>
          </footer>
        </>
      )}
      {polity && (
        <>
          <div className="card-kicker card-kicker-heritage">
            {fmtYear(polity.start)} - {fmtYear(polity.end)}
          </div>
          <h2 className="card-title">{polity.name}</h2>
          <hr className="card-rule" />
          <dl className="card-meta">
            <dt>Seat</dt><dd>{polity.capital.name}</dd>
          </dl>
          <p className="card-body">{polity.note}</p>
          <footer className="card-sources">{polity.sources.join(" · ")}</footer>
        </>
      )}
    </article>
  );
}

export function fmtYear(y: number): string {
  return y < 0 ? `${-y} BCE` : `${y} CE`;
}
