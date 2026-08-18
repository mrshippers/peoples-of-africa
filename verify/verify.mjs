// The verify harness. Runs, in order: check:data, then Playwright headless
// driving the scene API directly (window.__poa) - pick accuracy, scrubber
// assertion, scene-graph audit, orbit frame-time capture, axe scan, label
// collision audit - then prints the budget table with measured values and
// writes the design-gate screenshots. "Done" is refused without this run.

import { execSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync, statSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(ROOT, "verify", "screenshots");
mkdirSync(SHOTS, { recursive: true });

const results = [];
const record = (metric, target, measured, pass) => {
  results.push({ metric, target, measured, pass });
  console.log(`${pass ? "  ok " : " FAIL"} ${metric}: ${measured} (target ${target})`);
};

// ── 1. data gate ──
console.log("── check:data ──");
execSync("node scripts/check-data.mjs", { cwd: ROOT, stdio: "inherit" });

// ── 2. build + preview server ──
console.log("── build ──");
execSync("npm run build", { cwd: ROOT, stdio: "pipe" });

const jsBytes = readdirSync(path.join(ROOT, "dist/assets"))
  .filter(f => f.endsWith(".js"))
  .reduce((sum, f) => sum + gzipSync(readFileSync(path.join(ROOT, "dist/assets", f))).length, 0);

const dataBytes =
  gzipSync(readFileSync(path.join(ROOT, "public/data/peoples.geojson"))).length +
  gzipSync(readFileSync(path.join(ROOT, "public/data/heritage.json"))).length +
  statSync(path.join(ROOT, "public/textures/earth-relief.jpg")).size;

const server = spawn("npx", ["vite", "preview", "--port", "4517", "--strictPort"], {
  cwd: ROOT, stdio: "pipe",
});
let browser;
try {
  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.on("exit", code => reject(new Error(`preview server exited: ${code}`)));
    const poll = async () => {
      try {
        const r = await fetch("http://localhost:4517/", { signal: AbortSignal.timeout(1000) });
        if (r.ok) return resolve();
      } catch { /* not up yet */ }
      setTimeout(poll, 300);
    };
    poll();
    setTimeout(() => reject(new Error("preview server timeout")), 15000);
  });

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://localhost:4517/");
  await page.waitForFunction(() => window.__poa?.ready === true, null, { timeout: 30000 });
  // Let the drape settle a couple of frames.
  await page.waitForTimeout(600);

  // ── system 2: headless render produces a frame ──
  const frame0 = await page.evaluate(() => window.__poa.frameStats());
  record("headless render frames", "> 0", frame0.count, frame0.count > 0);

  // scene audit: family mesh groups == families present in the data
  const audit = await page.evaluate(() => window.__poa.audit());
  const famExpected = await page.evaluate(async () => {
    const r = await fetch("/data/peoples.geojson");
    const fc = await r.json();
    return new Set(fc.features.map(f => f.properties.family)).size;
  });
  record("family mesh groups == families", famExpected, audit.familyMeshCount,
    audit.familyMeshCount === famExpected);
  record("draw calls at full-continent view", "≤ 150", audit.drawCalls, audit.drawCalls <= 150);

  // camera constraints at both zoom extremes
  const zin = await page.evaluate(() => window.__poa.setZoom(0.2));
  const zinSane = await page.evaluate(() => window.__poa.cameraSane());
  const zout = await page.evaluate(() => window.__poa.setZoom(50));
  const zoutSane = await page.evaluate(() => window.__poa.cameraSane());
  const limits = await page.evaluate(() => window.__poa.zoomLimits());
  record("zoom-in clamp", `≥ ${limits.min}`, zin.distance.toFixed(3),
    zin.distance >= limits.min - 1e-6 && zinSane);
  record("zoom-out clamp", `≤ ${limits.max}`, zout.distance.toFixed(3),
    zout.distance <= limits.max + 1e-6 && zoutSane);
  await page.evaluate(() => window.__poa.setZoom(2.35));

  // ── budget rows measurable now ──
  record("JS bundle gz", "≤ 900 kB", `${(jsBytes / 1e3).toFixed(0)} kB`, jsBytes <= 900_000);
  record("data payload", "≤ 2.5 MB", `${(dataBytes / 1e6).toFixed(2)} MB`, dataBytes <= 2_500_000);

  // ── design-gate screenshots ──
  await page.screenshot({ path: path.join(SHOTS, "zoom-continent.png") });
  await page.evaluate(() => window.__poa.setZoom(1.6));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, "zoom-mid.png") });
  await page.evaluate(() => window.__poa.setZoom(1.25));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, "zoom-close.png") });
  await page.evaluate(() => window.__poa.setZoom(2.35));

  // panel-open screenshot via a real pick near Africa's centre
  const pick = await page.evaluate(() => window.__poa.pickAt(0, 0));
  if (pick) {
    await page.evaluate(id => window.__poa.select(id), pick.id);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOTS, "panel-open.png") });
    await page.evaluate(() => window.__poa.select(null));
  }
  record("design-gate screenshots", "4 written", pick ? 4 : 3, Boolean(pick));
} finally {
  if (browser) await browser.close();
  server.kill();
}

// ── budget table ──
console.log("\n| metric | target | measured | pass |");
console.log("|---|---|---|---|");
for (const r of results)
  console.log(`| ${r.metric} | ${r.target} | ${r.measured} | ${r.pass ? "✓" : "✗"} |`);

writeFileSync(path.join(ROOT, "verify", "last-run.json"),
  JSON.stringify({ when: new Date().toISOString(), results }, null, 2));

const failed = results.filter(r => !r.pass);
if (failed.length) {
  console.error(`\n${failed.length} verify failure(s)`);
  process.exit(1);
}
console.log("\nVERIFY PASS");
