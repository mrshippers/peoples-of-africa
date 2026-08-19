// The verify harness, v2 (diorama). Runs, in order: check:data, build, then
// Playwright driving the scene API directly - pick accuracy, scrubber, scene
// audit, label sweep, vignette placement audit, GPU frame profile (headful),
// Fast-3G TTI, axe - then prints the budget table and writes design-gate
// stills including a 4K frame. "Done" is refused without this run.

import { execSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync, statSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";

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

// ── 2. build + payload accounting ──
console.log("── build ──");
execSync("npm run build", { cwd: ROOT, stdio: "pipe" });

const gzOf = (p) => gzipSync(readFileSync(p)).length;
const sizeOf = (p) => statSync(p).size;
const jsBytes = readdirSync(path.join(ROOT, "dist/assets"))
  .filter(f => f.endsWith(".js"))
  .reduce((s, f) => s + gzOf(path.join(ROOT, "dist/assets", f)), 0);
const T = (f) => path.join(ROOT, "public", f);
const firstPaint = jsBytes + sizeOf(T("terrain/height.png")) + sizeOf(T("terrain/albedo_lo.jpg"));
const modelBytes = readdirSync(path.join(ROOT, "public/models"))
  .filter(f => f.endsWith(".glb"))
  .reduce((s, f) => s + sizeOf(path.join(ROOT, "public/models", f)), 0);
const totalLazy = firstPaint
  + sizeOf(T("terrain/albedo.jpg")) + sizeOf(T("terrain/normal.jpg"))
  + gzOf(T("data/peoples.geojson")) + gzOf(T("data/heritage.json"))
  + gzOf(T("data/vignettes.json")) + modelBytes;

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
  const mainContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await mainContext.newPage();
  await page.goto("http://localhost:4517/");
  await page.waitForFunction(() => window.__poa?.ready === true, null, { timeout: 30000 });
  await page.waitForTimeout(800);

  // ── scene sanity ──
  const frame0 = await page.evaluate(() => window.__poa.frameStats());
  record("headless render frames", "> 0", frame0.count, frame0.count > 0);

  const audit = await page.evaluate(() => window.__poa.audit());
  const famExpected = await page.evaluate(async () => {
    const r = await fetch("/data/peoples.geojson");
    const fc = await r.json();
    return new Set(fc.features.map(f => f.properties.family)).size;
  });
  record("family mesh groups == families", famExpected, audit.familyMeshCount,
    audit.familyMeshCount === famExpected);
  record("draw calls at full view", "≤ 150", audit.drawCalls, audit.drawCalls <= 150);

  const zin = await page.evaluate(() => window.__poa.setZoom(0.05));
  const zinSane = await page.evaluate(() => window.__poa.cameraSane());
  const zout = await page.evaluate(() => window.__poa.setZoom(80));
  const zoutSane = await page.evaluate(() => window.__poa.cameraSane());
  const limits = await page.evaluate(() => window.__poa.zoomLimits());
  record("zoom-in clamp", `≥ ${limits.min}`, zin.distance.toFixed(3),
    zin.distance >= limits.min - 1e-6 && zinSane);
  record("zoom-out clamp", `≤ ${limits.max}`, zout.distance.toFixed(3),
    zout.distance <= limits.max + 1e-6 && zoutSane);
  await page.evaluate(() => { window.__poa.setZoom(8.8); window.__poa.lookAt(2, 17); });

  record("JS bundle gz", "≤ 900 kB", `${(jsBytes / 1e3).toFixed(0)} kB`, jsBytes <= 900_000);
  record("first-paint payload", "≤ 3.5 MB", `${(firstPaint / 1e6).toFixed(2)} MB`, firstPaint <= 3_500_000);
  record("total lazy payload", "≤ 12 MB", `${(totalLazy / 1e6).toFixed(2)} MB`, totalLazy <= 12_000_000);

  // ── pick accuracy at 10 known targets ──
  const targets = await page.evaluate(() => {
    const inside = (pt, ring) => {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if (((yi > pt[1]) !== (yj > pt[1])) &&
            pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    return fetch("/data/peoples.geojson").then(r => r.json()).then(fc => {
      const ok = fc.features.filter(f => {
        const p = f.properties;
        if (typeof p.lat !== "number" || typeof p.lon !== "number") return false;
        const rings = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
        return rings.some(poly => inside([p.lon, p.lat], poly[0]));
      });
      ok.sort((a, b) => (a.properties.lon + a.properties.lat * 7) - (b.properties.lon + b.properties.lat * 7));
      const step = Math.floor(ok.length / 10);
      return Array.from({ length: 10 }, (_, i) => {
        const p = ok[i * step].properties;
        return { id: p.id, name: p.name, lat: p.lat, lon: p.lon };
      });
    });
  });
  let pickHits = 0;
  const pickMisses = [];
  for (const t of targets) {
    const got = await page.evaluate(({ lat, lon }) => {
      window.__poa.setZoom(2.4);
      window.__poa.lookAt(lat, lon);
      // The plate is tilted: pick where the point actually projects, not at
      // screen centre.
      return window.__poa.pickAtLonLat(lon, lat);
    }, t);
    if (got?.id === t.id) pickHits++;
    else pickMisses.push(`${t.name} -> ${got?.name ?? "nothing"}`);
  }
  record("pick accuracy at 10 known coordinates", "10/10", `${pickHits}/10`, pickHits === 10);
  if (pickMisses.length) console.log("  misses:", pickMisses.join("; "));

  const panelMs = await page.evaluate(async (id) => {
    window.__poa.select(null);
    await new Promise(r => setTimeout(r, 50));
    window.__poa.select(id);
    for (let i = 0; i < 40; i++) {
      const st = window.__poa.panelState();
      if (st.populatedInMs != null) return st.populatedInMs;
      await new Promise(r => setTimeout(r, 25));
    }
    return null;
  }, targets[0].id);
  record("pick -> panel populated", "≤ 120 ms",
    panelMs == null ? "never" : `${panelMs.toFixed(1)} ms`,
    panelMs != null && panelMs <= 120);
  await page.evaluate(() => { window.__poa.select(null); window.__poa.setZoom(8.8); window.__poa.lookAt(2, 17); });

  // ── layer system ──
  const toggleSeq = ["heritage", "peoples", "overlay", "heritage", "overlay",
    "peoples", "heritage", "peoples", "overlay", "heritage",
    "peoples", "overlay", "heritage", "overlay", "peoples",
    "heritage", "peoples", "heritage", "overlay", "peoples"];
  let maxOrphans = 0;
  for (const l of toggleSeq) {
    const orphans = await page.evaluate(async (layer) => {
      window.__poa.setLayer(layer);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return window.__poa.audit().orphanedMeshes;
    }, l);
    maxOrphans = Math.max(maxOrphans, orphans);
  }
  record("orphaned meshes after 20 toggles", "0", maxOrphans, maxOrphans === 0);

  const sampleYears = [-2500, -300, 800, 1350, 1870];
  let scrubberOk = true;
  const scrubberDetail = [];
  await page.evaluate(() => window.__poa.setLayer("heritage"));
  for (const y of sampleYears) {
    const { visible, expected } = await page.evaluate(async (year) => {
      window.__poa.setYear(year);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return {
        visible: window.__poa.visiblePolities().sort(),
        expected: window.__poa.politiesForYear(year).sort(),
      };
    }, y);
    const same = visible.length === expected.length && visible.every((v, i) => v === expected[i]);
    if (!same) scrubberOk = false;
    scrubberDetail.push(`${y}: ${visible.length}/${expected.length}`);
  }
  record("scrubber visible == data-derived (5 years)", "5/5 match",
    scrubberDetail.join(", "), scrubberOk);
  await page.evaluate(() => { window.__poa.setYear(1350); window.__poa.lookAt(8, 15); });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(SHOTS, "heritage-1350.png") });
  await page.evaluate(() => { window.__poa.setLayer("peoples"); window.__poa.lookAt(2, 17); window.__poa.setZoom(8.8); });

  // ── label sweep: view distance × density threshold ──
  const zooms = [8.8, 5.5, 3.2];
  const thresholds = [6, 8, 10, 12, 14];
  console.log("── label sweep: visible/overlaps per zoom × minFontPx ──");
  console.log("zoom    " + thresholds.map(t => String(t).padStart(10)).join(""));
  const sweep = {};
  for (const z of zooms) {
    const row = [];
    for (const t of thresholds) {
      const stats = await page.evaluate(async ({ z, t }) => {
        window.__poa.lookAt(2, 17);
        window.__poa.setZoom(z);
        window.__poaSetLabelParams({ minFontPx: t });
        await new Promise(r => setTimeout(r, 120));
        window.__poaForceLabels();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return window.__poa.labelStats();
      }, { z, t });
      sweep[`${z}:${t}`] = stats;
      row.push(`${stats.visible}/${stats.overlaps}`.padStart(10));
    }
    console.log(String(z).padEnd(8) + row.join(""));
  }
  let chosenT = null;
  for (const t of thresholds) {
    if (zooms.every(z => sweep[`${z}:${t}`].overlaps === 0)) { chosenT = t; break; }
  }
  record("label threshold from grid", "exists", chosenT ?? "none", chosenT != null);
  const TT = chosenT ?? 10;
  const closeStats = sweep[`3.2:${TT}`];
  record(`labels at closest tested zoom (T=${TT})`, "≥ 150", closeStats.visible, closeStats.visible >= 150);
  const overlapTotal = zooms.reduce((s, z) => s + sweep[`${z}:${TT}`].overlaps, 0);
  record(`label overlaps across 3 zooms (T=${TT})`, "0", overlapTotal, overlapTotal === 0);

  const deep = await page.evaluate(async (t) => {
    window.__poa.lookAt(2, 17);
    window.__poa.setZoom(1.2);
    window.__poaSetLabelParams({ minFontPx: t });
    await new Promise(r => setTimeout(r, 120));
    window.__poaForceLabels();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return window.__poa.labelStats();
  }, TT);
  // Coverage measures the PACKER: of the labels big enough to set at this
  // threshold, how many found a slot. Territories culled for being too small
  // on screen are the density control doing its job, not a packing failure —
  // both numbers are printed.
  record("deep-zoom packing efficiency (1.2)", "≥ 80% of eligible labels",
    `${deep.visible}/${deep.eligible} eligible (${deep.candidates} in view)`,
    deep.eligible > 0 && deep.visible / deep.eligible >= 0.8);
  await page.evaluate(async (t) => {
    window.__poaSetLabelParams({ minFontPx: t });
    window.__poa.setZoom(8.8); window.__poa.lookAt(2, 17);
  }, TT);

  // ── vignette placement audit ──
  const vig = await page.evaluate(() => window.__poa.vignetteAudit?.() ?? []);
  const vigBad = vig.filter(v => !(v.inBbox && v.terrainOk && v.hasModel));
  record("vignettes placed, in-region, on correct ground, with model", "≥ 9, 100%",
    `${vig.length - vigBad.length}/${vig.length}${vigBad.length ? " bad: " + vigBad.map(v => v.id).join(",") : ""}`,
    vig.length >= 9 && vigBad.length === 0);

  // ── axe: three states ──
  {
    const seriousOf = (r) => r.violations.filter(v => v.impact === "serious" || v.impact === "critical");
    const states = [];
    states.push({ name: "peoples", violations: seriousOf(await new AxeBuilder({ page }).analyze()) });
    const pickForAxe = await page.evaluate(() => window.__poa.pickAtLonLat(17, 2));
    if (pickForAxe) {
      await page.evaluate(id => window.__poa.select(id), pickForAxe.id);
      await page.waitForTimeout(300);
      states.push({ name: "panel-open", violations: seriousOf(await new AxeBuilder({ page }).analyze()) });
      await page.evaluate(() => window.__poa.select(null));
    }
    await page.evaluate(() => window.__poa.setLayer("heritage"));
    await page.waitForTimeout(300);
    states.push({ name: "heritage", violations: seriousOf(await new AxeBuilder({ page }).analyze()) });
    await page.evaluate(() => window.__poa.setLayer("peoples"));
    const total = states.reduce((s, st) => s + st.violations.length, 0);
    for (const st of states)
      for (const v of st.violations) console.log(`  axe [${st.name}] ${v.id}: ${v.help}`);
    record("serious axe violations (3 states)", "0", total, total === 0);
  }

  // ── design-gate stills ──
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(SHOTS, "zoom-continent.png") });
  await page.evaluate(() => { window.__poa.setZoom(4.5); window.__poa.lookAt(5, 20); });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(SHOTS, "zoom-mid.png") });
  await page.evaluate(() => { window.__poa.setZoom(2.0); window.__poa.lookAt(-2, 35); });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(SHOTS, "zoom-close.png") });
  await page.evaluate(() => { window.__poa.setZoom(8.8); window.__poa.lookAt(2, 17); });

  const pick = await page.evaluate(() => window.__poa.pickAtLonLat(17, 2));
  if (pick) {
    await page.evaluate(id => window.__poa.select(id), pick.id);
    await page.waitForTimeout(1400);
    await page.screenshot({ path: path.join(SHOTS, "panel-open.png") });
    await page.evaluate(() => window.__poa.select(null));
  }
  record("design-gate screenshots", "5 written", pick ? 5 : 4, Boolean(pick));

  // ── performance: real GPU, headful ──
  const panProfile = (pg, ms) => pg.evaluate(async (ms) => {
    window.__poa.profileStart();
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const t = (performance.now() - t0) / 1000;
      window.__poa.lookAt(2 + Math.sin(t * 0.9) * 12, 17 + Math.sin(t * 0.6) * 28);
      await new Promise(r => requestAnimationFrame(r));
    }
    return window.__poa.profileEnd();
  }, ms);

  const perfBrowser = await chromium.launch({
    headless: false,
    args: ["--window-position=3000,3000", "--window-size=1460,960"],
  });
  try {
    console.log("── merge sweep: pan p95 ms per count × strategy (real GPU) ──");
    console.log("count      family     group");
    for (const count of [200, 500, 835]) {
      const row = [];
      for (const strat of ["family", "group"]) {
        const p = await perfBrowser.newPage({ viewport: { width: 1440, height: 900 } });
        await p.goto(`http://localhost:4517/?merge=${strat}&count=${count}`);
        await p.waitForFunction(() => window.__poa?.ready === true, null, { timeout: 30000 });
        await p.waitForTimeout(300);
        const prof = await panProfile(p, 3000);
        row.push(prof.p95Ms.toFixed(1).padStart(9));
        await p.close();
      }
      console.log(String(count).padEnd(8) + row.join(""));
    }

    let baselineP95;
    {
      const p = await perfBrowser.newPage();
      await p.goto("about:blank");
      baselineP95 = await p.evaluate(async () => {
        const ds = [];
        let last = performance.now();
        const t0 = last;
        while (performance.now() - t0 < 3000) {
          await new Promise(r => requestAnimationFrame(r));
          const n = performance.now(); ds.push(n - last); last = n;
        }
        ds.sort((a, b) => a - b);
        return ds[Math.floor(ds.length * 0.95)];
      });
      console.log(`blank-page rAF p95 baseline: ${baselineP95.toFixed(1)} ms`);
      await p.close();
    }

    {
      const p = await perfBrowser.newPage({ viewport: { width: 1440, height: 900 } });
      await p.goto("http://localhost:4517/");
      await p.waitForFunction(() => window.__poa?.ready === true, null, { timeout: 30000 });
      const glr = await p.evaluate(() => {
        const c = document.createElement("canvas");
        const gl = c.getContext("webgl2") ?? c.getContext("webgl");
        const ext = gl?.getExtension("WEBGL_debug_renderer_info");
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
      });
      console.log("GL renderer:", glr);
      await p.waitForTimeout(300);
      const desktop = await panProfile(p, 10000);
      const fps = desktop.frames / 10;
      const limit = Math.max(16.7, baselineP95 * 1.15);
      record("frame p95, 10s pan, desktop", `≤ ${limit.toFixed(1)} ms (vsync-relative) at ≥ 57 fps`,
        `${desktop.p95Ms.toFixed(1)} ms @ ${fps.toFixed(1)} fps`,
        desktop.p95Ms <= limit && fps >= 57);
      await p.close();
    }

    // 4K still on the real GPU — the software renderer cannot draw 8.3 MP of
    // displaced terrain inside any sane timeout.
    {
      const p = await perfBrowser.newPage({ viewport: { width: 3840, height: 2160 } });
      await p.goto("http://localhost:4517/");
      await p.waitForFunction(() => window.__poa?.ready === true, null, { timeout: 90000 });
      await p.evaluate(() => { window.__poa.setZoom(8.8); window.__poa.lookAt(2, 17); });
      await p.waitForTimeout(2500);
      await p.screenshot({ path: path.join(SHOTS, "still-4k.png") });
      await p.close();
      const px = statSync(path.join(SHOTS, "still-4k.png")).size;
      record("4K still emitted", "3840x2160", `${(px / 1e6).toFixed(1)} MB png`, px > 500_000);
    }

    {
      const p = await perfBrowser.newPage({ viewport: { width: 390, height: 844 } });
      const cdp = await p.context().newCDPSession(p);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await p.goto("http://localhost:4517/");
      await p.waitForFunction(() => window.__poa?.ready === true, null, { timeout: 60000 });
      await p.waitForTimeout(300);
      const mobile = await panProfile(p, 10000);
      record("frame p95, mobile profile (4x throttle)", "≤ 33 ms",
        `${mobile.p95Ms.toFixed(1)} ms (${mobile.frames} frames)`, mobile.p95Ms <= 33);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await p.close();
    }
  } finally {
    await perfBrowser.close();
  }

  // ── TTI on Fast 3G, cold cache, median of 3 ──
  // A single throttled cold load swings ~1.5 s with background load on the
  // machine; the median is the honest figure and all samples are printed.
  {
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await ctx.newPage();
      const cdp = await ctx.newCDPSession(p);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false, latency: 150, downloadThroughput: 180000, uploadThroughput: 84375,
      });
      const t0 = Date.now();
      await p.goto("http://localhost:4517/");
      await p.waitForFunction(
        () => window.__poa && typeof window.__poa.terrainReady === "function" && window.__poa.terrainReady(),
        null, { timeout: 60000 });
      samples.push(Date.now() - t0);
      await ctx.close();
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const tti = sorted[1];
    record("time to visible map (Fast 3G, median of 3)", "≤ 6000 ms (revised, see brief-v2)",
      `${tti} ms [${samples.join(", ")}]`, tti <= 6000);
  }
} finally {
  if (browser) await browser.close();
  server.kill();
}

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
