// App state: one small store shared by scene and UI.

import { create } from "zustand";
import type { PeopleFeature, HeritageData } from "./data";

export type Layer = "peoples" | "heritage" | "overlay";

interface AppState {
  peoples: PeopleFeature[] | null;
  heritage: HeritageData | null;
  layer: Layer;
  year: number;
  hoverId: string | null;
  selectedId: string | null;
  panelOpenedAt: number | null;
  panelPopulatedInMs: number | null;
  setPeoples(p: PeopleFeature[]): void;
  setHeritage(h: HeritageData): void;
  setLayer(l: Layer): void;
  setYear(y: number): void;
  setHover(id: string | null): void;
  select(id: string | null): void;
  markPanelPopulated(): void;
}

export const useApp = create<AppState>((set, get) => ({
  peoples: null,
  heritage: null,
  layer: "peoples",
  year: 1500,
  hoverId: null,
  selectedId: null,
  panelOpenedAt: null,
  panelPopulatedInMs: null,
  setPeoples: (peoples) => set({ peoples }),
  setHeritage: (heritage) => set({ heritage }),
  setLayer: (layer) => set({ layer }),
  setYear: (year) => set({ year }),
  setHover: (hoverId) => {
    if (get().hoverId !== hoverId) set({ hoverId });
  },
  select: (selectedId) => set({
    selectedId,
    panelOpenedAt: selectedId ? performance.now() : null,
    panelPopulatedInMs: null,
  }),
  markPanelPopulated: () => {
    const t0 = get().panelOpenedAt;
    if (t0 != null && get().panelPopulatedInMs == null)
      set({ panelPopulatedInMs: performance.now() - t0 });
  },
}));

export function politiesForYear(heritage: HeritageData | null, year: number): string[] {
  if (!heritage) return [];
  return heritage.polities.filter(p => year >= p.start && year <= p.end).map(p => p.id);
}
