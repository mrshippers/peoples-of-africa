// Data gate for system 1. Validates schema and prints counts; exit 1 on any failure.
// Brief requires: >=300 groups, 100% with family + polygon; >=40 polities, 100%
// with date range + extent.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAMILIES = new Set([
  "Afro-Asiatic", "Nilo-Saharan", "Niger-Congo", "Khoisan", "Austronesian", "Indo-European",
]);

let failures = 0;
const fail = (msg) => { failures++; console.error("FAIL:", msg); };

// ── peoples.geojson ──
const peoplesPath = path.join(ROOT, "public/data/peoples.geojson");
const peoples = JSON.parse(readFileSync(peoplesPath, "utf8"));
if (peoples.type !== "FeatureCollection") fail("peoples: not a FeatureCollection");
const feats = peoples.features ?? [];

let withFamily = 0, withPolygon = 0, badFamily = 0;
const ids = new Set();
for (const f of feats) {
  const p = f.properties ?? {};
  if (!p.id || !p.name) fail(`peoples: feature missing id/name: ${JSON.stringify(p).slice(0, 80)}`);
  if (ids.has(p.id)) fail(`peoples: duplicate id ${p.id}`);
  ids.add(p.id);
  if (p.family && FAMILIES.has(p.family)) withFamily++;
  else { badFamily++; if (badFamily <= 5) fail(`peoples: ${p.name}: bad family ${p.family}`); }
  const g = f.geometry;
  const ok = g && (g.type === "Polygon" || g.type === "MultiPolygon") &&
    Array.isArray(g.coordinates) && g.coordinates.length > 0;
  if (ok) withPolygon++;
  else fail(`peoples: ${p.name}: missing/empty geometry`);
}
if (feats.length < 300) fail(`peoples: only ${feats.length} groups (< 300)`);
if (withFamily !== feats.length) fail(`peoples: ${feats.length - withFamily} groups without valid family`);
if (withPolygon !== feats.length) fail(`peoples: ${feats.length - withPolygon} groups without polygon`);

// ── heritage.json ──
const heritagePath = path.join(ROOT, "public/data/heritage.json");
const heritage = JSON.parse(readFileSync(heritagePath, "utf8"));
const pols = heritage.polities ?? [];
const polIds = new Set();
let withRange = 0, withExtent = 0;
for (const p of pols) {
  if (!p.id || !p.name) fail(`heritage: polity missing id/name`);
  if (polIds.has(p.id)) fail(`heritage: duplicate id ${p.id}`);
  polIds.add(p.id);
  if (Number.isInteger(p.start) && Number.isInteger(p.end) && p.start < p.end) withRange++;
  else fail(`heritage: ${p.name}: bad date range ${p.start}..${p.end}`);
  const e = p.extent;
  const ringOk = Array.isArray(e) && e.length >= 4 &&
    e.every(pt => Array.isArray(pt) && pt.length === 2 &&
      pt[0] >= -20 && pt[0] <= 52 && pt[1] >= -36 && pt[1] <= 38);
  const closed = ringOk && e[0][0] === e[e.length - 1][0] && e[0][1] === e[e.length - 1][1];
  if (ringOk && closed) withExtent++;
  else fail(`heritage: ${p.name}: extent not a closed ring inside Africa bounds`);
  if (!p.capital?.name || typeof p.capital?.lon !== "number" || typeof p.capital?.lat !== "number")
    fail(`heritage: ${p.name}: capital missing`);
  if (!p.note || p.note.split(/\s+/).length < 15) fail(`heritage: ${p.name}: note too short`);
  if (!Array.isArray(p.sources) || p.sources.length === 0) fail(`heritage: ${p.name}: no sources`);
}
if (pols.length < 40) fail(`heritage: only ${pols.length} polities (< 40)`);

// ── payload report (budget asserted in verify, v2 numbers) ──
const gz = (f) => gzipSync(readFileSync(f)).length;
const payload = {
  "peoples.geojson (gz)": gz(peoplesPath),
  "heritage.json (gz)": gz(heritagePath),
};

console.log("── check:data ──");
console.log(`groups: ${feats.length} (${withFamily} with family, ${withPolygon} with polygon)`);
const famCount = {};
for (const f of feats) famCount[f.properties.family] = (famCount[f.properties.family] ?? 0) + 1;
console.log("families:", famCount);
console.log(`polities: ${pols.length} (${withRange} with date range, ${withExtent} with extent)`);
for (const [k, v] of Object.entries(payload)) console.log(`${k}: ${(v / 1e3).toFixed(0)} kB`);

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("PASS");
