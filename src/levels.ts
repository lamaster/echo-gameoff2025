import { buildMaze, buildMazeFromRows, generateMazeRows, type MazeData } from './maze';
import type { Vec3 } from './types';

type CellCoord = { c: number; r: number };
type TargetHint = CellCoord | { fracC: number; fracR: number };

export type BeaconData = { id: string; cell: CellCoord; position: Vec3 };
export type LevelData = {
  id: number;
  name: string;
  description: string;
  sizeLabel: string;
  maze: MazeData;
  requiresKey: boolean;
  key?: { cell: CellCoord; position: Vec3 };
  beacons: BeaconData[];
  pingLimit?: number;
  timeLimitSec?: number;
  faceExit?: boolean;
  isBonus?: boolean;
};

type LevelSpec = {
  id: number;
  name: string;
  description: string;
  layout?: string[];
  generator?: { cols: number; rows: number; seed: number; extraConnectors?: number; forceOdd?: boolean };
  sizeLabel?: string;
  requiresKey?: boolean;
  keyHint?: TargetHint;
  beaconHints?: TargetHint[];
  pingLimit?: number;
  timeLimitSec?: number;
  faceExit?: boolean;
  isBonus?: boolean;
};

const CELL_SIZE = 1.2;

function cellToWorld(maze: MazeData, cell: CellCoord): Vec3 {
  const cx0 = -0.5 * maze.cols * maze.cellSize;
  const cz0 = -0.5 * maze.rows * maze.cellSize;
  return {
    x: cx0 + cell.c * maze.cellSize + maze.cellSize * 0.5,
    y: 1.2,
    z: cz0 + cell.r * maze.cellSize + maze.cellSize * 0.5,
  };
}

function nearestOpen(rows: string[], target: CellCoord): CellCoord {
  const cols = rows[0].length;
  const rowsCount = rows.length;
  const clamp = (v: number, max: number): number => Math.min(max - 1, Math.max(0, v));
  const baseC = clamp(target.c, cols);
  const baseR = clamp(target.r, rowsCount);
  const maxRad = Math.max(cols, rowsCount);
  for (let rad = 0; rad < maxRad; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      const r = baseR + dr;
      if (r < 0 || r >= rowsCount) continue;
      const dc = rad - Math.abs(dr);
      const candidates = dc === 0 ? [baseC] : [baseC - dc, baseC + dc];
      for (const c of candidates) {
        if (c < 0 || c >= cols) continue;
        const cell = rows[r][c];
        if (cell !== '1') return { c, r };
      }
    }
  }
  return { c: baseC, r: baseR };
}

function resolveHint(rows: string[], hint?: TargetHint): CellCoord | null {
  if (!hint) return null;
  if ('fracC' in hint) {
    const cols = rows[0].length;
    const rowsCount = rows.length;
    return nearestOpen(rows, {
      c: Math.round((cols - 1) * hint.fracC),
      r: Math.round((rowsCount - 1) * hint.fracR),
    });
  }
  return nearestOpen(rows, hint);
}

function parseLayout(layout: string[]): { rows: string[]; keys: CellCoord[]; beacons: CellCoord[] } {
  const rows: string[] = [];
  const keys: CellCoord[] = [];
  const beacons: CellCoord[] = [];
  let startFound = false;
  let exitFound = false;
  layout.forEach((line, r) => {
    let out = '';
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '#') out += '1';
      else if (ch === '.' || ch === ' ') out += '0';
      else if (ch === 'S') {
        startFound = true;
        out += '2';
      } else if (ch === 'E') {
        exitFound = true;
        out += '3';
      } else if (ch === 'K') {
        keys.push({ c, r });
        out += '0';
      } else if (ch === 'B') {
        beacons.push({ c, r });
        out += '0';
      } else {
        out += ch === '1' ? '1' : '0';
      }
    }
    rows.push(out);
  });
  if (!startFound || !exitFound) {
    throw new Error('Layout must include start (S) and exit (E) cells');
  }
  return { rows, keys, beacons };
}

function findCell(rows: string[], target: string): CellCoord | null {
  for (let r = 0; r < rows.length; r++) {
    const c = rows[r].indexOf(target);
    if (c >= 0) return { c, r };
  }
  return null;
}

function shortestPathBetween(rows: string[], start: CellCoord, target: CellCoord): CellCoord[] {
  const key = (c: CellCoord): string => `${c.c},${c.r}`;
  const passable = (c: number, r: number): boolean => {
    if (r < 0 || c < 0 || r >= rows.length || c >= rows[0].length) return false;
    const cell = rows[r][c];
    return cell !== '1';
  };
  const queue: Array<CellCoord & { p?: CellCoord }> = [{ ...start }];
  const seen = new Set<string>([key(start)]);
  let found: (CellCoord & { p?: CellCoord }) | undefined;
  while (queue.length) {
    const cur = queue.shift();
    if (!cur) break;
    if (cur.c === target.c && cur.r === target.r) {
      found = cur;
      break;
    }
    const dirs = [
      { dc: 1, dr: 0 },
      { dc: -1, dr: 0 },
      { dc: 0, dr: 1 },
      { dc: 0, dr: -1 },
    ];
    for (const d of dirs) {
      const nc = cur.c + d.dc;
      const nr = cur.r + d.dr;
      if (!passable(nc, nr)) continue;
      const k = `${nc},${nr}`;
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ c: nc, r: nr, p: cur });
    }
  }
  if (!found) return [];
  const path: CellCoord[] = [];
  let cur: (CellCoord & { p?: CellCoord }) | undefined = found;
  while (cur) {
    path.push({ c: cur.c, r: cur.r });
    cur = cur.p;
  }
  return path.reverse();
}

function shortestPath(rows: string[]): CellCoord[] {
  const start = findCell(rows, '2');
  const exit = findCell(rows, '3');
  if (!start || !exit) return [];
  return shortestPathBetween(rows, start, exit);
}

function farthestCell(rows: string[], start: CellCoord, exit: CellCoord): CellCoord | null {
  const passable = (c: number, r: number): boolean => {
    if (r < 0 || c < 0 || r >= rows.length || c >= rows[0].length) return false;
    const cell = rows[r][c];
    return cell !== '1';
  };
  const distFrom = (src: CellCoord): number[][] => {
    const dist: number[][] = Array.from({ length: rows.length }, () => Array(rows[0].length).fill(Infinity));
    const queue: Array<CellCoord & { d: number }> = [{ ...src, d: 0 }];
    dist[src.r][src.c] = 0;
    while (queue.length) {
      const cur = queue.shift();
      if (!cur) break;
      const dirs = [
        { dc: 1, dr: 0 },
        { dc: -1, dr: 0 },
        { dc: 0, dr: 1 },
        { dc: 0, dr: -1 },
      ];
      for (const d of dirs) {
        const nc = cur.c + d.dc;
        const nr = cur.r + d.dr;
        if (!passable(nc, nr)) continue;
        if (dist[nr][nc] <= cur.d + 1) continue;
        dist[nr][nc] = cur.d + 1;
        queue.push({ c: nc, r: nr, d: cur.d + 1 });
      }
    }
    return dist;
  };
  const distStart = distFrom(start);
  const distExit = distFrom(exit);
  let best: CellCoord | null = null;
  let bestScore = -Infinity;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[0].length; c++) {
      if (!passable(c, r)) continue;
      if ((c === start.c && r === start.r) || (c === exit.c && r === exit.r)) continue;
      const ds = distStart[r][c];
      const de = distExit[r][c];
      if (!Number.isFinite(ds) || !Number.isFinite(de)) continue;
      const score = ds + de;
      if (score > bestScore) {
        bestScore = score;
        best = { c, r };
      }
    }
  }
  return best;
}

function buildLevel(spec: LevelSpec): LevelData {
  let maze: MazeData;
  let keyCells: CellCoord[] = [];
  let beaconCells: CellCoord[] = [];

  if (spec.layout) {
    const parsed = parseLayout(spec.layout);
    maze = buildMazeFromRows(parsed.rows, CELL_SIZE);
    keyCells = parsed.keys;
    beaconCells = parsed.beacons;
  } else if (spec.generator) {
    const rows = generateMazeRows({
      cols: spec.generator.cols,
      rows: spec.generator.rows,
      seed: spec.generator.seed,
      extraConnectors: spec.generator.extraConnectors,
      forceOdd: spec.generator.forceOdd,
    });
    maze = buildMaze(CELL_SIZE, {
      cols: spec.generator.cols,
      rows: spec.generator.rows,
      seed: spec.generator.seed,
      extraConnectors: spec.generator.extraConnectors,
      rowsGrid: rows,
      forceOdd: spec.generator.forceOdd,
    });
    const key = resolveHint(rows, spec.keyHint);
    if (key) keyCells.push(key);
    if (spec.beaconHints) {
      for (const bh of spec.beaconHints) {
        const bc = resolveHint(rows, bh);
        if (bc) beaconCells.push(bc);
      }
    }
  } else {
    throw new Error(`Level ${spec.id} missing layout or generator`);
  }

  const sizeLabel = spec.sizeLabel ?? `${maze.cols}x${maze.rows}`;
  const startCell = findCell(maze.rowsGrid, '2');
  const exitCell = findCell(maze.rowsGrid, '3');
  const requiresKey = spec.requiresKey ?? keyCells.length > 0;
  if (requiresKey && startCell && exitCell) {
    const farCell = farthestCell(maze.rowsGrid, startCell, exitCell);
    if (farCell) keyCells = [farCell];
  }
  const keyCell = keyCells[0];
  const key = keyCell ? { cell: keyCell, position: cellToWorld(maze, keyCell) } : undefined;
  const beaconPath =
    startCell && exitCell ? shortestPathBetween(maze.rowsGrid, startCell, exitCell) : shortestPath(maze.rowsGrid);
  const beaconCount = spec.beaconHints?.length ?? beaconCells.length;
  if (beaconCount > 0 && beaconPath.length > 0) {
    beaconCells = [];
    const edges = beaconPath.length - 1;
    const startEdge = Math.min(edges - 1, Math.max(1, Math.floor(edges * 0.3)));
    let lastIdx = startEdge;
    for (let i = 1; i <= beaconCount; i++) {
      const target = startEdge + (edges - startEdge) * (i / (beaconCount + 1));
      const idx = Math.max(lastIdx + 1, Math.min(beaconPath.length - 2, Math.round(target)));
      beaconCells.push(beaconPath[idx]);
      lastIdx = idx;
    }
  }
  const beacons: BeaconData[] = beaconCells.map((cell, idx) => {
    return {
      id: `B${spec.id}-${idx + 1}`,
      cell,
      position: cellToWorld(maze, cell),
    };
  });

  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    sizeLabel,
    maze,
    requiresKey,
    key,
    beacons,
    pingLimit: spec.pingLimit,
    timeLimitSec: spec.timeLimitSec,
    faceExit: spec.faceExit,
    isBonus: spec.isBonus,
  };
}

const LEVEL_SPECS: LevelSpec[] = [
  {
    id: 1,
    name: 'Dawn',
    description: 'Intro room: tiny 4x4, door faces the player.',
    layout: ['####', '#S.#', '#.E#', '####'],
    sizeLabel: '4x4',
    faceExit: true,
  },
  {
    id: 2,
    name: 'Forks',
    description: '7x7 with a couple dead ends, exit hidden behind a wall.',
    layout: ['#######', '#S....#', '#.###.#', '#.#E#.#', '#.#...#', '#.....#', '#######'],
  },
  {
    id: 3,
    name: 'Loops',
    description: '9x9 with extra loops and long corridors.',
    generator: { cols: 9, rows: 9, seed: 2003, extraConnectors: 3 },
  },
  {
    id: 4,
    name: 'Keep',
    description: 'Find the key to open the 11x11 door. No beacons.',
    generator: { cols: 11, rows: 11, seed: 2004, extraConnectors: 2 },
    requiresKey: true,
    keyHint: { fracC: 0.72, fracR: 0.28 },
  },
  {
    id: 5,
    name: 'Passages',
    description: '13x13: first beacon plus key in one level.',
    generator: { cols: 18, rows: 18, seed: 2005, extraConnectors: 4 },
    requiresKey: true,
    keyHint: { fracC: 0.34, fracR: 0.2 },
    beaconHints: [{ fracC: 0.64, fracR: 0.58 }],
  },
  {
    id: 6,
    name: 'Beacons',
    description: 'Deep 20x20: key + beacon navigation.',
    generator: { cols: 25, rows: 25, seed: 2006, extraConnectors: 6, forceOdd: false },
    requiresKey: true,
    keyHint: { fracC: 0.82, fracR: 0.82 },
    beaconHints: [
      { fracC: 0.25, fracR: 0.32 },
      { fracC: 0.68, fracR: 0.18 },
      { fracC: 0.38, fracR: 0.74 },
    ],
  },
  {
    id: 7,
    name: 'Bonus',
    description: 'Hard mode with beacons: larger maze with timer and long dead ends.',
    generator: { cols: 25, rows: 25, seed: 2007, extraConnectors: 1 },
    pingLimit: 12,
    timeLimitSec: 120,
    requiresKey: true,
    keyHint: { fracC: 0.82, fracR: 0.18 },
    beaconHints: [
      { fracC: 0.2, fracR: 0.2 },
      { fracC: 0.5, fracR: 0.5 },
      { fracC: 0.8, fracR: 0.8 },
    ],
    isBonus: true,
  },
];

export const LEVELS: LevelData[] = LEVEL_SPECS.map((spec) => buildLevel(spec));

export function getLevel(index: number): LevelData {
  const idx = Math.max(0, Math.min(index, LEVELS.length - 1));
  return LEVELS[idx];
}
