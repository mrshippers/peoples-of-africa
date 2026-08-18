// The heritage year scrubber: a ruled timeline with set dates, not a media
// slider. Dragging scrubs the year; arrow keys step it (instant, no animation
// on keyboard actions).

import { useCallback, useRef } from "react";
import { useApp } from "../state";
import { fmtYear } from "./DetailCard";

export const YEAR_MIN = -2700;
export const YEAR_MAX = 1900;
const TICKS = [-2500, -2000, -1500, -1000, -500, 1, 500, 1000, 1500, 1900];

export function Timeline() {
  const layer = useApp(s => s.layer);
  const year = useApp(s => s.year);
  const setYear = useApp(s => s.setYear);
  const heritage = useApp(s => s.heritage);
  const railRef = useRef<HTMLDivElement>(null);

  const toYear = useCallback((clientX: number) => {
    const rect = railRef.current!.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(YEAR_MIN + t * (YEAR_MAX - YEAR_MIN));
  }, []);

  if (layer === "peoples" || !heritage) return null;

  const frac = (year - YEAR_MIN) / (YEAR_MAX - YEAR_MIN);
  const liveCount = heritage.polities.filter(p => year >= p.start && year <= p.end).length;

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setYear(toYear(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons & 1) setYear(toYear(e.clientX));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") setYear(Math.max(YEAR_MIN, year - 25));
    if (e.key === "ArrowRight") setYear(Math.min(YEAR_MAX, year + 25));
  };

  return (
    <div className="timeline" role="slider" tabIndex={0}
      aria-label="Year" aria-valuemin={YEAR_MIN} aria-valuemax={YEAR_MAX} aria-valuenow={year}
      aria-valuetext={fmtYear(year)}
      onKeyDown={onKeyDown}>
      <div className="timeline-readout">
        <span className="timeline-year">{fmtYear(year)}</span>
        <span className="timeline-count">{liveCount} polities</span>
      </div>
      <div className="timeline-rail" ref={railRef}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}>
        <div className="timeline-rule" />
        {TICKS.map(t => (
          <div key={t} className="timeline-tick"
            style={{ left: `${((t - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100}%` }}>
            <span>{t < 0 ? `${-t}` : t === 1 ? "1 CE" : `${t}`}</span>
          </div>
        ))}
        <div className="timeline-cursor" style={{ left: `${frac * 100}%` }} />
      </div>
    </div>
  );
}
