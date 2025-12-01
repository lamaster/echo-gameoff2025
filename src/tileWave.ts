import { MazeMeta, Walls } from './materials';
import type { Vec2 } from './types';

export type TileWave = {
  width: number;
  height: number;
  cellSize: number;
  originX: number;
  originZ: number;
  mask: Float32Array;
  prev: Float32Array;
  curr: Float32Array;
  next: Float32Array;
  tex: WebGLTexture;
  texData: Float32Array;
  lastPingTime: number;
};

const WAVE_RES = 128;

function buildBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const w of Walls) {
    minX = Math.min(minX, w.cx - w.hx);
    maxX = Math.max(maxX, w.cx + w.hx);
    minZ = Math.min(minZ, w.cz - w.hz);
    maxZ = Math.max(maxZ, w.cz + w.hz);
  }
  return { minX, maxX, minZ, maxZ };
}

function cellIndex(x: number, y: number, w: number): number {
  return y * w + x;
}

export function createTileWave(gl: WebGL2RenderingContext): TileWave {
  const { minX, maxX, minZ, maxZ } = buildBounds();
  const width = WAVE_RES;
  const height = WAVE_RES;
  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;
  const cellSize = Math.max(spanX / width, spanZ / height, MazeMeta.cellSize / 2);
  const originX = minX - 0.5 * cellSize;
  const originZ = minZ - 0.5 * cellSize;
  const mask = new Float32Array(width * height);
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const worldX = originX + (x + 0.5) * cellSize;
      const worldZ = originZ + (z + 0.5) * cellSize;
      let solid = 0;
      for (const w of Walls) {
        const dx = Math.max(0, Math.abs(worldX - w.cx) - w.hx);
        const dz = Math.max(0, Math.abs(worldZ - w.cz) - w.hz);
        if (dx < 0.01 && dz < 0.01) {
          solid = 1;
          break;
        }
      }
      mask[cellIndex(x, z, width)] = solid;
    }
  }
  const prev = new Float32Array(width * height);
  const curr = new Float32Array(width * height);
  const next = new Float32Array(width * height);
  const texData = new Float32Array(width * height * 4);
  const tex = gl.createTexture();
  if (!tex) throw new Error('tile wave texture alloc failed');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, texData);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { width, height, cellSize, originX, originZ, mask, prev, curr, next, tex, texData, lastPingTime: -1 };
}

export function worldToTile(tile: TileWave, p: Vec2): { x: number; z: number } {
  const x = Math.floor((p.x - tile.originX) / tile.cellSize);
  const z = Math.floor((p.z - tile.originZ) / tile.cellSize);
  return { x, z };
}

export function injectPing(tile: TileWave, pos: Vec2, amp = 1.0): void {
  const { x, z } = worldToTile(tile, pos);
  if (x < 0 || z < 0 || x >= tile.width || z >= tile.height) return;
  const idx = cellIndex(x, z, tile.width);
  if (tile.mask[idx] > 0.5) return;
  tile.curr[idx] += amp;
}

export function stepTileWave(tile: TileWave, dt: number): void {
  const w = tile.width;
  const h = tile.height;
  const c = 8.0;
  const damp = 0.012;
  const c2 = (c * dt) / tile.cellSize;
  const factor = c2 * c2;
  for (let z = 1; z < h - 1; z++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = cellIndex(x, z, w);
      if (tile.mask[idx] > 0.5) {
        tile.next[idx] = 0;
        continue;
      }
      const lap =
        tile.curr[idx - 1] + tile.curr[idx + 1] + tile.curr[idx - w] + tile.curr[idx + w] - 4 * tile.curr[idx];
      const nextVal = (2 - damp) * tile.curr[idx] - (1 - damp) * tile.prev[idx] + factor * lap;
      tile.next[idx] = nextVal;
    }
  }
  // edges: copy current to avoid artifacts
  for (let x = 0; x < w; x++) {
    tile.next[x] = 0;
    tile.next[(h - 1) * w + x] = 0;
  }
  for (let z = 0; z < h; z++) {
    tile.next[z * w] = 0;
    tile.next[z * w + (w - 1)] = 0;
  }
  const tmp = tile.prev;
  tile.prev = tile.curr;
  tile.curr = tile.next;
  tile.next = tmp;
}

export function uploadTileWave(gl: WebGL2RenderingContext, tile: TileWave): void {
  const w = tile.width;
  const h = tile.height;
  const td = tile.texData;
  const c = tile.curr;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const v = c[i];
    td[p] = v;
    td[p + 1] = 0;
    td[p + 2] = 0;
    td[p + 3] = 1;
  }
  gl.bindTexture(gl.TEXTURE_2D, tile.tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, td);
}
