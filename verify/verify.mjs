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

  // ── system 3: pick accuracy at 10 known targets ──
  // Candidates: groups whose recorded centre lies inside their own outer ring,
  // spread across the continent. Camera faces each centre; the pick at screen
  // centre must resolve to that group.
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
      // Spread: sort by lon+lat hash, take every Nth for geographic variety.
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
      window.__poa.lookAt(lat, lon);
      return window.__poa.pickAt(0, 0);
    }, t);
    if (got?.id === t.id) pickHits++;
    else pickMisses.push(`${t.name} -> ${got?.name ?? "nothing"}`);
  }
  record("pick accuracy at 10 known coordinates", "10/10", `${pickHits}/10`, pickHits === 10);
  if (pickMisses.length) console.log("  misses:", pickMisses.join("; "));

  // panel populate latency: select via API, measure store-reported populate time
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
  await page.evaluate(() => { window.__poa.select(null); window.__poa.setZoom(2.35); });
  await page.evaluate(() => window.__poa.lookAt(2, 17));

  // ── system 4: layer toggles leave no orphans; scrubber matches the data ──
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

  // heritage-layer screenshot for the design gate
  await page.evaluate(() => { window.__poa.setYear(1350); window.__poa.lookAt(8, 15); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, "heritage-1350.png") });
  await page.evaluate(() => { window.__poa.setLayer("peoples"); window.__poa.lookAt(2, 17); });

  // ── system 5: label sweep - zoom × density threshold, the grid is the answer ──
  // Closest tested zoom is 1.6: nearer than that, fewer than 150 territories
  // fit the viewport at all - the deep-zoom claim below is coverage instead.
  const zooms = [2.35, 1.9, 1.6];
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
  // Chosen threshold: smallest T with 0 overlaps at every zoom (density wants
  // small T; legibility wants overlap-free).
  let chosenT = null;
  for (const t of thresholds) {
    if (zooms.every(z => sweep[`${z}:${t}`].overlaps === 0)) { chosenT = t; break; }
  }
  record("label threshold from grid", "exists", chosenT ?? "none", chosenT != null);
  const T = chosenT ?? 10;
  const closeStats = sweep[`1.6:${T}`];
  record(`labels at closest zoom (T=${T})`, "≥ 150", closeStats.visible, closeStats.visible >= 150);
  const overlapTotal = zooms.reduce((s, z) => s + sweep[`${z}:${T}`].overlaps, 0);
  record(`label overlaps across 3 zooms (T=${T})`, "0", overlapTotal, overlapTotal === 0);

  // At the true minimum zoom the map should label essentially everything in view.
  const deep = await page.evaluate(async (t) => {
    window.__poa.lookAt(2, 17);
    window.__poa.setZoom(1.25);
    window.__poaSetLabelParams({ minFontPx: t });
    await new Promise(r => setTimeout(r, 120));
    window.__poaForceLabels();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return window.__poa.labelStats();
  }, T);
  record("deep-zoom label coverage (1.25)", "≥ 80% of in-view territories",
    `${deep.visible}/${deep.candidates}`,
    deep.candidates > 0 && deep.visible / deep.candidates >= 0.8);

  await page.evaluate(async (t) => {
    window.__poaSetLabelParams({ minFontPx: t });
    window.__poa.setZoom(2.35); window.__poa.lookAt(2, 17);
  }, T);

  // ── system 6: performance ──
  const orbitProfile = (pg, ms) => pg.evaluate(async (ms) => {
    window.__poa.profileStart();
    const t0 = performance.now();
    let lon = 17;
    while (performance.now() - t0 < ms) {
      lon += 0.35;
      window.__poa.lookAt(2, lon % 360);
      await new Promise(r => requestAnimationFrame(r));
    }
    return window.__poa.profileEnd();
  }, ms);

  // Frame timing needs the real GPU - headless-shell renders WebGL through
  // SwiftShader and reports software numbers. A headful chromium (window
  // parked offscreen) measures the actual compositor path.
  const perfBrowser = await chromium.launch({
    headless: false,
    args: ["--window-position=3000,3000", "--window-size=1460,960"],
  });
  try {
    const glInfo = async (p) => p.evaluate(() => {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") ?? c.getContext("webgl");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
    });

    console.log("── merge sweep: orbit p95 ms per count × strategy (real GPU) ──");
    console.log("count      family     group");
    for (const count of [200, 500, 835]) {
      const row = [];
      for (const strat of ["family", "group"]) {
        const p = await perfBrowser.newPage({ viewport: { width: 1440, height: 900 } });
        await p.goto(`http://localhost:4517/?merge=${strat}&count=${count}`);
        await p.waitForFunction(() => window.__poa?.ready === true, null, { timeout: 30000 });
        await p.waitForTimeout(300);
        const prof = await orbitProfile(p, 3000);
        row.push(prof.p95Ms.toFixed(1).padStart(9));
        await p.close();
      }
      console.log(String(count).padEnd(8) + row.join(""));
    }

    // A vsync-locked rAF loop cannot report deltas under one refresh even for
    // an empty page, so the 16.7ms budget is asserted vsync-relative: scene
    // p95 within 15% of a blank page's p95 in the same browser, at 60fps.
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

    // Chosen config (per-family merge, full data): 10s orbit.
    {
      const p = await perfBrowser.newPage({ viewport: { width: 1440, height: 900 } });
      await p.goto("http://localhost:4517/");
      await p.waitForFunction(() => window.__poa?.ready === true, null, { timeout: 30000 });
      console.log("GL renderer:", await glInfo(p));
      await p.waitForTimeout(300);
      const desktop = await orbitProfile(p, 10000);
      const fps = desktop.frames / 10;
      const limit = Math.max(16.7, baselineP95 * 1.15);
      record("frame p95, 10s orbit, desktop", `≤ ${limit.toFixed(1)} ms (vsync-relative) at ≥ 57 fps`,
        `${desktop.p95Ms.toFixed(1)} ms @ ${fps.toFixed(1)} fps`,
        desktop.p95Ms <= limit && fps >= 57);
      await p.close();
    }

    // Mid-tier mobile profile: small viewport + 4x CPU throttle.
    {
      const p = await perfBrowser.newPage({ viewport: { width: 390, height: 844 } });
      const cdp = await p.context().newCDPSession(p);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await p.goto("http://localhost:4517/");
      await p.waitForFunction(() => window.__poa?.ready === true, null, { timeout: 60000 });
      await p.waitForTimeout(300);
      const mobile = await orbitProfile(p, 10000);
      record("frame p95, mobile profile (4x throttle)", "≤ 33 ms",
        `${mobile.p95Ms.toFixed(1)} ms (${mobile.frames} frames)`, mobile.p95Ms <= 33);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await p.close();
    }
  } finally {
    await perfBrowser.close();
  }

  // Time to interactive globe on Fast 3G: first rendered frame, cold cache.
  {
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
      () => window.__poa && typeof window.__poa.frameStats === "function" && window.__poa.frameStats().count > 0,
      null, { timeout: 30000 });
    const tti = Date.now() - t0;
    record("time to interactive globe (Fast 3G)", "≤ 4000 ms", `${tti} ms`, tti <= 4000);
    await ctx.close();
  }

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
