// Data layer: one deep module. Fetches and types the two static datasets,
// owns the family key. Nothing here knows about three.js or React.

export type FamilyName =
  | "Afro-Asiatic" | "Nilo-Saharan" | "Niger-Congo"
  | "Khoisan" | "Austronesian" | "Indo-European";

export interface PeopleProps {
  id: string;
  name: string;
  family: FamilyName;
  glottocode: string | null;
  language: string | null;
  group: string | null;
  ea: string | null;
  lat: number;
  lon: number;
}

export type Ring = [number, number][];

export interface PeopleFeature {
  properties: PeopleProps;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
}

export interface Polity {
  id: string;
  name: string;
  start: number;
  end: number;
  capital: { name: string; lon: number; lat: number };
  note: string;
  sources: string[];
  extent: Ring;
}

export interface HeritageData {
  meta: { title: string; note: string; sources: string[] };
  polities: Polity[];
}

// The 1971 map's six-way key (Greenberg). Ink-wash colours tuned for the
// muted relief base; order is legend order.
export const FAMILIES: { name: FamilyName; color: string; gloss: string }[] = [
  { name: "Niger-Congo", color: "#4F7A4A", gloss: "Bantu, Yoruba, Igbo, Mande, Zulu - the continent's largest family" },
  { name: "Afro-Asiatic", color: "#C7A02E", gloss: "Arabic, Berber, Hausa, Amharic, Somali - north and Horn" },
  { name: "Nilo-Saharan", color: "#A85E3C", gloss: "Nilotic, Saharan, Songhay - middle Nile and central Sahara" },
  { name: "Khoisan", color: "#C8B37A", gloss: "Click languages of the San and Khoikhoi - the oldest strata" },
  { name: "Austronesian", color: "#8E5A9E", gloss: "Malagasy - Madagascar settled from Southeast Asia" },
  { name: "Indo-European", color: "#6E7B8A", gloss: "Afrikaans, English, French, Portuguese - colonial-era arrivals" },
];

export const familyColor = new Map(FAMILIES.map(f => [f.name, f.color]));

let peoplesCache: PeopleFeature[] | null = null;
let heritageCache: HeritageData | null = null;

export async function loadPeoples(): Promise<PeopleFeature[]> {
  if (peoplesCache) return peoplesCache;
  const res = await fetch(`${import.meta.env.BASE_URL}data/peoples.geojson`);
  if (!res.ok) throw new Error(`peoples.geojson: ${res.status}`);
  const fc = await res.json();
  peoplesCache = fc.features as PeopleFeature[];
  return peoplesCache;
}

export async function loadHeritage(): Promise<HeritageData> {
  if (heritageCache) return heritageCache;
  const res = await fetch(`${import.meta.env.BASE_URL}data/heritage.json`);
  if (!res.ok) throw new Error(`heritage.json: ${res.status}`);
  heritageCache = await res.json() as HeritageData;
  return heritageCache;
}
