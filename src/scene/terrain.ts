// The plate: projection contract and the height field. Everything that places
// anything on the diorama goes through mapToWorld + HeightField.
//
// Contract (must match scripts/bake-terrain.py):
//   plate spans lon -25..60 (8.5 world units), lat -40..40 (8.0 units)
//   world: x east, z south, y up; plate centre at origin
//   land y  = h * 22 / 1.11e6
//   sea  y  = h * 10 / 1.11e6

import * as THREE from "three";

export const PLATE = {
  west: -25, east: 60, south: -40, north: 40,
  W: 8.5, H: 8.0,
};
export const S_LAND = 22 / 1.11e6;
export const S_SEA = 10 / 1.11e6;
export const DRAPE_LIFT = 0.006;

export function lonToX(lon: number): number {
  return ((lon - PLATE.west) / (PLATE.east - PLATE.west) - 0.5) * PLATE.W;
}
export function latToZ(lat: number): number {
  return ((PLATE.north - lat) / (PLATE.north - PLATE.south) - 0.5) * PLATE.H;
}
export function heightToY(h: number): number {
  return h >= 0 ? h * S_LAND : h * S_SEA;
}

export class HeightField {
  readonly width: number;
  readonly height: number;
  private data: Float32Array;

  private constructor(width: number, height: number, data: Float32Array) {
    this.width = width;
    this.height = height;
    this.data = data;
  }

  static async load(url: string): Promise<HeightField> {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const data = new Float32Array(img.width * img.height);
    for (let i = 0; i < data.length; i++) {
      data[i] = px[i * 4] * 256 + px[i * 4 + 1] - 11000;
    }
    return new HeightField(img.width, img.height, data);
  }

  /** metres at lon/lat, bilinear */
  sample(lon: number, lat: number): number {
    const u = (lon - PLATE.west) / (PLATE.east - PLATE.west) * (this.width - 1);
    const v = (PLATE.north - lat) / (PLATE.north - PLATE.south) * (this.height - 1);
    const x0 = Math.max(0, Math.min(this.width - 2, Math.floor(u)));
    const y0 = Math.max(0, Math.min(this.height - 2, Math.floor(v)));
    const fx = Math.max(0, Math.min(1, u - x0));
    const fy = Math.max(0, Math.min(1, v - y0));
    const i = y0 * this.width + x0;
    const a = this.data[i], b = this.data[i + 1];
    const c = this.data[i + this.width], d = this.data[i + this.width + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  worldY(lon: number, lat: number): number {
    return heightToY(this.sample(lon, lat));
  }
}

export function mapToWorld(lon: number, lat: number, y: number): THREE.Vector3 {
  return new THREE.Vector3(lonToX(lon), y, latToZ(lat));
}

/** Terrain mesh: plane displaced on the CPU from the height field. */
export function buildTerrainGeometry(hf: HeightField, segX?: number, segZ?: number): THREE.BufferGeometry {
  // Mesh density follows the height tier: the first plate is coarse so it
  // appears immediately; the full map rebuilds it fine.
  const fine = hf.width > 500;
  segX = segX ?? (fine ? 512 : 176);
  segZ = segZ ?? (fine ? 483 : 166);
  const geo = new THREE.PlaneGeometry(PLATE.W, PLATE.H, segX, segZ);
  geo.rotateX(-Math.PI / 2); // XZ plane, +y up; +z = south after rotation
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const lon = PLATE.west + (pos.getX(i) / PLATE.W + 0.5) * (PLATE.east - PLATE.west);
    const lat = PLATE.north - (pos.getZ(i) / PLATE.H + 0.5) * (PLATE.north - PLATE.south);
    pos.setY(i, hf.worldY(lon, lat));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}
