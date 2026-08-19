// App state: one small store shared by scene and UI.

import { create } from "zustand";
import type { PeopleFeature, HeritageData } from "./data";
import type { HeightField } from "./scene/terrain";

export type Layer = "peoples" | "heritage" | "overlay";

export interface VignetteDef {
  id: string;
  label: string;
  sub: string;
  model: string;      // glb name in public/models, or @pyramids/@baobabs/@marker
  lon: number;
  lat: number;
  scale: number;
  rotY: number;
  needs: "land" | "water";
  bbox: [number, number, number, number]; // lon0, lat0, lon1, lat1
}

interface AppState {
  peoples: PeopleFeature[] | null;
  heritage: HeritageData | null;
  heightField: HeightField | null;
  vignettes: VignetteDef[] | null;
  baseReady: boolean;   // plate + low-res albedo on screen
  layer: Layer;
  year: number;
  hoverId: string | null;
  selectedId: string | null;
  panelOpenedAt: number | null;
  panelPopulatedInMs: number | null;
  setPeoples(p: PeopleFeature[]): void;
  setHeritage(h: HeritageData): void;
  setHeightField(h: HeightField): void;
  setVignettes(v: VignetteDef[]): void;
  setBaseReady(): void;
  setLayer(l: Layer): void;
  setYear(y: number): void;
  setHover(id: string | null): void;
  select(id: string | null): void;
  markPanelPopulated(): void;
}

export const useApp = create<AppState>((set, get) => ({
  peoples: null,
  heritage: null,
  heightField: null,
  vignettes: null,
  baseReady: false,
  layer: "peoples",
  year: 1500,
  hoverId: null,
  selectedId: null,
  panelOpenedAt: null,
  panelPopulatedInMs: null,
  setPeoples: (peoples) => set({ peoples }),
  setHeritage: (heritage) => set({ heritage }),
  setHeightField: (heightField) => set({ heightField }),
  setVignettes: (vignettes) => set({ vignettes }),
  setBaseReady: () => { if (!get().baseReady) set({ baseReady: true }); },
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
