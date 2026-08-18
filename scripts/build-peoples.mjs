// Build public/data/peoples.geojson from open sources.
//
// Sources (all open):
//   - Murdock (1959) tribal map of Africa, digitized by Nathan Nunn; GeoJSON
//     copy from github.com/sboysel/murdock (data-raw/Murdock_EA_2011_vkZ.geojson)
//   - D-PLACE Ethnographic Atlas societies.csv (CC-BY) - EA id -> glottocode
//   - Glottolog CLDF languages.csv (CC-BY) - glottocode -> top-level family
//
// Family display key follows Greenberg's six-way African classification as used
// on the 1971 map: Afro-Asiatic, Nilo-Saharan, Niger-Congo, Khoisan,
// Austronesian, Indo-European. Glottolog's finer top-level families are bucketed
// into those six via FAMILY_BUCKETS below. Groups that cannot be classified are
// dropped (the brief requires 100% of shipped groups to carry a family).
//
// Usage: node scripts/build-peoples.mjs [--srcdir <dir with the 3 raw files>]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache");
mkdirSync(CACHE, { recursive: true });

const SOURCES = {
  murdock: {
    file: "Murdock_EA_2011_vkZ.geojson",
    url: "https://raw.githubusercontent.com/sboysel/murdock/master/data-raw/Murdock_EA_2011_vkZ.geojson",
  },
  ea: {
    file: "ea_societies.csv",
    url: "https://raw.githubusercontent.com/D-PLACE/dplace-data/master/datasets/EA/societies.csv",
  },
  glottolog: {
    file: "glottolog_languages.csv",
    url: "https://raw.githubusercontent.com/glottolog/glottolog-cldf/master/cldf/languages.csv",
  },
};

const argSrc = process.argv.indexOf("--srcdir");
const srcdir = argSrc > -1 ? process.argv[argSrc + 1] : null;

async function fetchSource({ file, url }) {
  if (srcdir && existsSync(path.join(srcdir, file))) return path.join(srcdir, file);
  const cached = path.join(CACHE, file);
  if (!existsSync(cached)) {
    process.stdout.write(`fetching ${url}\n`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
  }
  return cached;
}

// Minimal CSV parser handling quoted fields.
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// Glottolog top-level family name -> Greenberg six-key bucket.
const FAMILY_BUCKETS = new Map(Object.entries({
  "Atlantic-Congo": "Niger-Congo",
  "Mande": "Niger-Congo",
  "Dogon": "Niger-Congo",
  "Ijoid": "Niger-Congo",
  "Heibanic": "Niger-Congo",
  "Heiban": "Niger-Congo",
  "Talodic": "Niger-Congo",
  "Talodi": "Niger-Congo",
  "Rashadic": "Niger-Congo",
  "Rashad": "Niger-Congo",
  "Katloid": "Niger-Congo",
  "Katla-Tima": "Niger-Congo",
  "Lafofa": "Niger-Congo",
  "Kadugli-Krongo": "Niger-Congo", // Greenberg's Kordofanian placement
  "Afro-Asiatic": "Afro-Asiatic",
  "Central Sudanic": "Nilo-Saharan",
  "Nilotic": "Nilo-Saharan",
  "Eastern Sudanic": "Nilo-Saharan",
  "East Sudanic": "Nilo-Saharan",
  "Saharan": "Nilo-Saharan",
  "Songhay": "Nilo-Saharan",
  "Furan": "Nilo-Saharan",
  "Fur": "Nilo-Saharan",
  "Maban": "Nilo-Saharan",
  "Kunama": "Nilo-Saharan",
  "Berta": "Nilo-Saharan",
  "Koman": "Nilo-Saharan",
  "Gumuz": "Nilo-Saharan",
  "Kuliak": "Nilo-Saharan",
  "Surmic": "Nilo-Saharan",
  "Nubian": "Nilo-Saharan",
  "Temeinic": "Nilo-Saharan",
  "Nyimang": "Nilo-Saharan",
  "Ama-Afitti": "Nilo-Saharan",
  "Dajuic": "Nilo-Saharan",
  "Daju": "Nilo-Saharan",
  "Eastern Jebel": "Nilo-Saharan",
  "Jebel": "Nilo-Saharan",
  "Taman": "Nilo-Saharan",
  "Mimi-Gaudefroy": "Nilo-Saharan",
  "Khoe-Kwadi": "Khoisan",
  "Kxʼa": "Khoisan",
  "Kx'a": "Khoisan",
  "Kxa": "Khoisan",
  "Tuu": "Khoisan",
  "Kru": "Niger-Congo",
  "South Omotic": "Afro-Asiatic",
  "Ta-Ne-Omotic": "Afro-Asiatic",
  "Blue Nile Mao": "Afro-Asiatic",
  "Nara": "Nilo-Saharan",
  "Sandawe": "Khoisan",
  "Hadza": "Khoisan",
  "Austronesian": "Austronesian",
  "Indo-European": "Indo-European",
}));

// Isolates / contested cases keyed by glottocode.
const GLOTTOCODE_BUCKETS = new Map(Object.entries({
  sand1273: "Khoisan",   // Sandawe
  hadz1240: "Khoisan",   // Hadza
  bang1363: "Niger-Congo", // Bangime (Greenberg-era: with Dogon)
  laal1242: "Nilo-Saharan", // Laal (unclassified; Greenberg-era area assignment)
  shab1252: "Nilo-Saharan", // Shabo
  onga1239: "Afro-Asiatic", // Ongota
  jala1262: "Niger-Congo",  // Jalaa
  mero1237: "Nilo-Saharan", // Meroitic
}));

// Corrections applied AFTER the EA-code join, keyed by map NAME.
// Two error classes in the digitized attribute table:
//   (a) Madagascar + Comoros polygons all carry CODE Ac42 (Yao-Makonde) - a
//       known label error; the EA's Madagascar cluster is Eh2/Eh3/Eh7/Eh8.
//   (b) Nunn's nearest-society concordance sometimes crosses a language-family
//       boundary (e.g. Chadic-speaking Bede under Kanuri's Saharan code).
// Each entry states the family per Glottolog's classification of the group's
// own language, bucketed to the Greenberg six-key.
const NAME_OVERRIDES = new Map(Object.entries({
  // (a) Madagascar - Malagasy (Austronesian); Comorian is Bantu.
  MERINA: { family: "Austronesian", language: "Merina Malagasy", glottocode: "meri1243" },
  TANALA: { family: "Austronesian", language: "Tanala Malagasy", glottocode: "tana1285" },
  ANTANDROY: { family: "Austronesian", language: "Tandroy Malagasy", glottocode: "tand1256" },
  SAKALAVA: { family: "Austronesian", language: "Sakalava Malagasy", glottocode: "saka1291" },
  BETSILEO: { family: "Austronesian", language: "Malagasy" },
  BARA: { family: "Austronesian", language: "Malagasy" },
  BETSIMISARAKA: { family: "Austronesian", language: "Malagasy" },
  MAHAFALY: { family: "Austronesian", language: "Malagasy" },
  ANTAISAKA: { family: "Austronesian", language: "Malagasy" },
  TSIMIHETY: { family: "Austronesian", language: "Malagasy" },
  SIHANAKA: { family: "Austronesian", language: "Malagasy" },
  COMORIANS: { family: "Niger-Congo", language: "Comorian" },
  // (b) cross-family concordance inheritances.
  BEDE: { family: "Afro-Asiatic", language: "Bade" },          // Chadic, not Saharan
  NGIZIM: { family: "Afro-Asiatic", language: "Ngizim" },      // Chadic
  MANDARA: { family: "Afro-Asiatic", language: "Wandala" },    // Chadic
  BUDUMA: { family: "Afro-Asiatic", language: "Buduma" },      // Chadic
  MUBI: { family: "Afro-Asiatic", language: "Mubi" },          // East Chadic
  KENGA: { family: "Afro-Asiatic", language: "Kenga" },        // East Chadic
  SHUWA: { family: "Afro-Asiatic", language: "Chadian Arabic" },
  HABBANIA: { family: "Afro-Asiatic", language: "Sudanese Arabic" },
  MESSIRIA: { family: "Afro-Asiatic", language: "Sudanese Arabic" },
  SELIM: { family: "Afro-Asiatic", language: "Sudanese Arabic" },
  HEMAT: { family: "Afro-Asiatic", language: "Sudanese Arabic" },
  FEZZAN: { family: "Afro-Asiatic", language: "Libyan Arabic" },
  KUFRA: { family: "Afro-Asiatic", language: "Libyan Arabic" },
  MAHAMID: { family: "Afro-Asiatic", language: "Arabic" },
  SOLIMAN: { family: "Afro-Asiatic", language: "Arabic" },
  MAURI: { family: "Afro-Asiatic", language: "Hausa" },
  ZAGHAWA: { family: "Nilo-Saharan", language: "Zaghawa" },    // Saharan, not Arab
  BERTI: { family: "Nilo-Saharan", language: "Berti" },        // Saharan
  MIDOBI: { family: "Nilo-Saharan", language: "Midob" },       // Nubian
  GUMUZ: { family: "Nilo-Saharan", language: "Gumuz" },
  KATLA: { family: "Niger-Congo", language: "Katla" },         // Kordofanian
  TUMTUM: { family: "Niger-Congo", language: "Kadugli" },      // Kordofanian (Greenberg)
  KAMBERI: { family: "Niger-Congo", language: "Kambari" },     // Kainji
  TIENGA: { family: "Niger-Congo", language: "Kyenga" },       // Mande
  KWENA: { family: "Niger-Congo", language: "Tswana" },
  KGALAGADI: { family: "Niger-Congo", language: "Kgalagadi" },
  NGWAKETSE: { family: "Niger-Congo", language: "Tswana" },
  TAWANA: { family: "Niger-Congo", language: "Tswana" },
  TEMBU: { family: "Niger-Congo", language: "Xhosa" },
  TLHARU: { family: "Niger-Congo", language: "Tswana" },
  KWANGARE: { family: "Niger-Congo", language: "Kwangali" },
  MBUKUSHU: { family: "Niger-Congo", language: "Mbukushu" },
  HIECHWARE: { family: "Khoisan", language: "Tshwa" },         // Khoe, in a Bantu cluster
  KISAMA: { family: "Niger-Congo", language: "Kimbundu" },     // EA code absent from D-PLACE
  KRAN: { family: "Niger-Congo", language: "Krahn" },          // Kru
}));

function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s\-'’/(])([a-z])/g, (m, p, c) => p + c.toUpperCase());
}

const [murdockPath, eaPath, glottoPath] = await Promise.all(
  [SOURCES.murdock, SOURCES.ea, SOURCES.glottolog].map(fetchSource)
);

const murdock = JSON.parse(readFileSync(murdockPath, "utf8"));
const eaRows = parseCSV(readFileSync(eaPath, "utf8"));
const glRows = parseCSV(readFileSync(glottoPath, "utf8"));

const eaByCode = new Map(eaRows.map(r => [r.id, r]));
const glById = new Map(glRows.map(r => [r.ID, r]));

function familyForGlottocode(gc) {
  if (GLOTTOCODE_BUCKETS.has(gc)) return GLOTTOCODE_BUCKETS.get(gc);
  const lang = glById.get(gc);
  if (!lang) return null;
  const famId = lang.Family_ID || lang.ID; // top-level families have no Family_ID
  if (GLOTTOCODE_BUCKETS.has(famId)) return GLOTTOCODE_BUCKETS.get(famId);
  const fam = glById.get(famId);
  if (!fam) return null;
  return FAMILY_BUCKETS.get(fam.Name) ?? null;
}

const stats = { total: 0, noCode: 0, noEA: 0, noGlotto: 0, noBucket: 0, kept: 0 };
const unbucketedFamilies = new Map();
const features = [];
// Source `id` is not unique (116 features carry id 0) - derive stable ids from names.
const seenIds = new Map();
function makeId(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const n = (seenIds.get(slug) ?? 0) + 1;
  seenIds.set(slug, n);
  return n === 1 ? slug : `${slug}-${n}`;
}

for (const f of murdock.features) {
  stats.total++;
  const p = f.properties;
  const code = (p.CODE || "").trim();
  const name = (p.NAME || "").trim();
  if (!name || !f.geometry) { stats.noCode++; continue; }
  // Desert voids are cartographic honesty, not peoples - leave them as bare relief.
  if (name.toUpperCase().startsWith("UNINHABITED")) { stats.uninhabited = (stats.uninhabited ?? 0) + 1; continue; }

  let family = null, glottocode = null, langName = null;
  const override = NAME_OVERRIDES.get(name.toUpperCase());
  if (override) {
    ({ family, language: langName = null, glottocode = null } = override);
    stats.overridden = (stats.overridden ?? 0) + 1;
  } else {
    const ea = code ? eaByCode.get(code) : null;
    if (ea?.glottocode) {
      glottocode = ea.glottocode;
      family = familyForGlottocode(glottocode);
      langName = glById.get(glottocode)?.Name ?? null;
      if (!family) {
        const lang = glById.get(glottocode);
        const fam = lang ? glById.get(lang.Family_ID || lang.ID) : null;
        if (fam) unbucketedFamilies.set(fam.Name, (unbucketedFamilies.get(fam.Name) ?? 0) + 1);
        stats.noBucket++;
      }
    } else if (code) stats.noEA++;
    else stats.noCode++;
  }

  if (!family) continue;

  stats.kept++;
  features.push({
    type: "Feature",
    properties: {
      id: makeId(name),
      name: titleCase(name),
      family,
      glottocode,
      language: langName,
      group: p.CultureGrp || null,
      ea: code || null,
      lat: p.LAT, lon: p.LON,
    },
    geometry: f.geometry,
  });
}

console.log("join stats:", stats);
if (unbucketedFamilies.size) console.log("unbucketed families:", [...unbucketedFamilies.entries()]);

const outDir = path.join(ROOT, "public", "data");
mkdirSync(outDir, { recursive: true });
const rawOut = path.join(CACHE, "peoples.raw.geojson");
writeFileSync(rawOut, JSON.stringify({ type: "FeatureCollection", features }));

// Simplify + quantize for payload budget. visvalingam weighted keeps cartographic character.
const finalOut = path.join(outDir, "peoples.geojson");
execSync(
  `npx --yes mapshaper "${rawOut}" -simplify visvalingam weighted 12% keep-shapes -clean -o precision=0.001 format=geojson "${finalOut}"`,
  { stdio: "inherit" }
);

const size = readFileSync(finalOut).length;
const gz = execSync(`gzip -c "${finalOut}" | wc -c`).toString().trim();
console.log(`peoples.geojson: ${features.length} groups, ${(size / 1e6).toFixed(2)} MB raw, ${(gz / 1e6).toFixed(2)} MB gz`);
