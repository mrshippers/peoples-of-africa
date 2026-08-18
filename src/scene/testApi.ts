// Imperative surface for the verify harness. Playwright drives this API
// directly (window.__poa) instead of going through the UI, so the tests
// measure the systems, not the render loop.

export interface SceneAudit {
  familyMeshCount: number;
  familyNames: string[];
  totalMeshCount: number;
  drawCalls: number;
  triangles: number;
  orphanedMeshes: number;
}

export interface PickResult { id: string; name: string; family: string }

export interface PoaTestApi {
  ready: boolean;
  audit(): SceneAudit;
  pickAt(ndcX: number, ndcY: number): PickResult | null;
  setZoom(distance: number): { distance: number; polar: number };
  zoomLimits(): { min: number; max: number };
  cameraSane(): boolean;
  setLayer(layer: "peoples" | "heritage" | "overlay"): void;
  getLayer(): string;
  setYear(year: number): void;
  visiblePolities(): string[];
  politiesForYear(year: number): string[];
  frameStats(): { count: number; last: number };
  labelStats(): { visible: number; overlaps: number };
  select(id: string | null): void;
  panelState(): { open: boolean; id: string | null; populatedInMs: number | null };
}

const api: Partial<PoaTestApi> = { ready: false };

export function registerTestApi(patch: Partial<PoaTestApi>) {
  Object.assign(api, patch);
  (window as unknown as { __poa: Partial<PoaTestApi> }).__poa = api;
}

registerTestApi({});
