// Shrink vignette GLBs: textures only (512px + webp). Geometry is left alone -
// `gltf-transform optimize` with compression silently produced 2.5 kB files
// with the meshes gone, so every output is validated before it replaces the
// original.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "public", "models");

/** Parse a .glb container properly: 12-byte header, then length-prefixed chunks. */
function glbJson(file) {
  const b = readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error("not a glb");
  let off = 12;
  while (off + 8 <= b.length) {
    const len = b.readUInt32LE(off);
    const type = b.readUInt32LE(off + 4);
    const start = off + 8;
    if (type === 0x4e4f534a) return JSON.parse(b.slice(start, start + len).toString("utf8"));
    off = start + len;
  }
  throw new Error("no JSON chunk");
}

const healthy = (file) => {
  const j = glbJson(file);
  return (j.meshes?.length ?? 0) > 0 && (j.accessors?.length ?? 0) > 0;
};

const gt = (args) => execFileSync("npx", ["--yes", "@gltf-transform/cli", ...args], { stdio: "pipe" });

let before = 0, after = 0;
for (const name of readdirSync(DIR).filter(f => f.endsWith(".glb"))) {
  const file = path.join(DIR, name);
  const size0 = statSync(file).size;
  before += size0;
  // The CLI picks its container format from the extension - a temp name not
  // ending in .glb silently yields glTF JSON, which then fails the guard.
  const tmpR = file.replace(/\.glb$/, ".tmp-r.glb");
  const tmpW = file.replace(/\.glb$/, ".tmp-w.glb");
  try {
    gt(["resize", file, tmpR, "--width", "512", "--height", "512"]);
    gt(["webp", tmpR, tmpW]);
    if (healthy(tmpW) && statSync(tmpW).size < size0) {
      writeFileSync(file, readFileSync(tmpW));
      console.log(`${name}: ${(size0 / 1024).toFixed(0)} kB -> ${(statSync(file).size / 1024).toFixed(0)} kB`);
    } else {
      console.log(`${name}: kept original (${(size0 / 1024).toFixed(0)} kB)`);
    }
  } catch (e) {
    console.log(`${name}: kept original (${String(e).split("\n")[0]})`);
  } finally {
    for (const t of [tmpR, tmpW]) if (existsSync(t)) unlinkSync(t);
  }
  after += statSync(file).size;
  if (!healthy(file)) throw new Error(`${name} is broken after optimize`);
}
console.log(`models total: ${(before / 1e6).toFixed(2)} MB -> ${(after / 1e6).toFixed(2)} MB`);
