import { buildMaze, type MazeData } from './maze';
import type { Vec2 } from './types';

export type MaterialDef = { id: number; name: string; reflect: number; absorbHF: number };
export type Wall = { cx: number; cy: number; cz: number; hx: number; hy: number; hz: number; mat: MaterialDef };
export type ExitDoor = {
  position: { x: number; y: number; z: number };
  normal: { x: number; z: number };
  yaw: number;
  width: number;
  depth: number;
};

export const Material: Record<
  'OUTER' | 'INNER' | 'METAL' | 'DOOR' | 'KEY' | 'BEACON_DARK' | 'BEACON_LIT',
  MaterialDef
> = {
  OUTER: { id: 1, name: 'outerWall', reflect: 0.7, absorbHF: 0.35 },
  INNER: { id: 2, name: 'stone', reflect: 0.55, absorbHF: 0.5 },
  METAL: { id: 3, name: 'metal', reflect: 0.85, absorbHF: 0.15 },
  DOOR: { id: 4, name: 'exitDoor', reflect: 0.9, absorbHF: 0.25 },
  KEY: { id: 5, name: 'key', reflect: 0.8, absorbHF: 0.2 },
  BEACON_DARK: { id: 6, name: 'beaconOff', reflect: 0.5, absorbHF: 0.35 },
  BEACON_LIT: { id: 7, name: 'beaconOn', reflect: 0.8, absorbHF: 0.2 },
};

function readMazeSeed(): number {
  if (typeof location === 'undefined') return 1;
  const v = Number(new URLSearchParams(location.search).get('mazeSeed'));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 1;
}

export let MazeSeed = readMazeSeed();
export let MazeLabel = `seed-${MazeSeed}`;

const MazeCellSize = 1.2;

export let Walls: Wall[] = [];
export let MazeStart = { x: 0, y: 1.2, z: 0 };
export let MazeExit = { x: 0, y: 1.2, z: 0 };
export let MazeMeta = { cols: 0, rows: 0, cellSize: MazeCellSize };
export let MazeBounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
export let MazeRows: string[] = [];

function findExitCell(): { c: number; r: number } {
  for (let r = 0; r < MazeRows.length; r++) {
    const c = MazeRows[r].indexOf('3');
    if (c !== -1) return { c, r };
  }
  return { c: 0, r: 0 };
}

function computeExitDoor(): ExitDoor {
  const exitCell = findExitCell();
  const dirs = [
    { dc: 0, dr: -1, normal: { x: 0, z: -1 } },
    { dc: 1, dr: 0, normal: { x: 1, z: 0 } },
    { dc: 0, dr: 1, normal: { x: 0, z: 1 } },
    { dc: -1, dr: 0, normal: { x: -1, z: 0 } },
  ];
  let best = dirs[0];
  let bestScore = -1e9;
  let strictBest: (typeof dirs)[number] | null = null;
  let strictScore = -1e9;
  for (const d of dirs) {
    const nr = exitCell.r + d.dr;
    const nc = exitCell.c + d.dc;
    if (nr < 0 || nc < 0 || nr >= MazeRows.length || nc >= MazeRows[0].length) continue;
    const cellFront = MazeRows[nr][nc];
    if (cellFront === '1') continue; // we need an opening in front of the door
    const left = MazeRows[exitCell.r + d.dc]?.[exitCell.c - d.dr] ?? '1';
    const right = MazeRows[exitCell.r - d.dc]?.[exitCell.c + d.dr] ?? '1';
    const back = MazeRows[exitCell.r - d.dr]?.[exitCell.c - d.dc] ?? '1';
    const wallsAround = (left === '1' ? 1 : 0) + (right === '1' ? 1 : 0) + (back === '1' ? 1 : 0);
    const isInside = nr > 0 && nc > 0 && nr < MazeRows.length - 1 && nc < MazeRows[0].length - 1;
    const score = wallsAround * 10 + (isInside ? 1 : 0);
    if (wallsAround === 3 && score > strictScore) {
      strictScore = score;
      strictBest = d;
    }
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  const chosen = strictBest ?? best;
  const cellSize = MazeMeta.cellSize;
  const doorWidth = cellSize * 0.7;
  const doorDepth = cellSize * 0.16;
  const offset = cellSize * 0.5 - doorDepth * 0.5 - 0.02;
  const position = {
    x: MazeExit.x - chosen.normal.x * offset,
    y: MazeExit.y,
    z: MazeExit.z - chosen.normal.z * offset,
  };
  const yaw = Math.atan2(chosen.normal.x, -chosen.normal.z);
  return { position, normal: chosen.normal, yaw, width: doorWidth, depth: doorDepth };
}

export let MazeExitDoor = computeExitDoor();

export function setMazeData(maze: MazeData, opts: { seed?: number; label?: string } = {}): void {
  MazeSeed = opts.seed ?? MazeSeed;
  MazeLabel = opts.label ?? `seed-${MazeSeed}`;
  Walls = maze.walls.map((w) => ({
    cx: w.cx,
    cy: w.cy,
    cz: w.cz,
    hx: w.hx,
    hy: w.hy,
    hz: w.hz,
    mat: w.mat === Material.OUTER.id ? Material.OUTER : Material.INNER,
  }));
  MazeStart = maze.start;
  MazeExit = maze.exit;
  MazeMeta = { cols: maze.cols, rows: maze.rows, cellSize: maze.cellSize };
  MazeBounds = maze.bounds;
  MazeRows = maze.rowsGrid;
  MazeExitDoor = computeExitDoor();
}

export function segIntersectsAABB(a: Vec2, b: Vec2, w: Wall): boolean {
  const minX = w.cx - w.hx;
  const maxX = w.cx + w.hx;
  const minZ = w.cz - w.hz;
  const maxZ = w.cz + w.hz;
  let tmin = 0.0;
  let tmax = 1.0;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (Math.abs(dx) < 1e-8) {
    if (a.x < minX || a.x > maxX) return false;
  } else {
    const inv = 1.0 / dx;
    let t1 = (minX - a.x) * inv;
    let t2 = (maxX - a.x) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-8) {
    if (a.z < minZ || a.z > maxZ) return false;
  } else {
    const inv = 1.0 / dz;
    let t1 = (minZ - a.z) * inv;
    let t2 = (maxZ - a.z) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return tmin < tmax && tmin > 1e-4 && tmax < 1.0 - 1e-4;
}

export function occlusionAtten(listener: Vec2, image: Vec2): { hits: number; gainMul: number; lpMul: number } {
  let hits = 0;
  let absorb = 0.0;
  for (const w of Walls) {
    if (segIntersectsAABB(listener, image, w)) {
      hits++;
      absorb += w.mat?.absorbHF ?? 0.4;
    }
  }
  if (hits === 0) return { hits: 0, gainMul: 1.0, lpMul: 1.0 };
  const gainMul = 0.5 ** Math.min(hits, 3);
  const lpMul = Math.max(0.25, 1.0 - 0.5 * absorb);
  return { hits, gainMul, lpMul };
}

export function buildWallUniforms(walls: Wall[]): { wallCount: number; wallA: Float32Array; wallB: Float32Array } {
  const wallCount = Math.min(walls.length, 128);
  const wallA = new Float32Array(wallCount * 4);
  const wallB = new Float32Array(wallCount * 4);
  for (let i = 0; i < wallCount; i++) {
    const w = walls[i];
    wallA[i * 4 + 0] = w.cx;
    wallA[i * 4 + 1] = w.cy;
    wallA[i * 4 + 2] = w.cz;
    wallA[i * 4 + 3] = w.hx;
    wallB[i * 4 + 0] = w.hy;
    wallB[i * 4 + 1] = w.hz;
    wallB[i * 4 + 2] = w.mat.id;
    wallB[i * 4 + 3] = 0;
  }
  return { wallCount, wallA, wallB };
}

setMazeData(buildMaze(MazeCellSize, { seed: MazeSeed }));
