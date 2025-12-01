import { describe, expect, it } from 'bun:test';
import { LEVELS, type LevelData } from '../levels';

type Cell = { c: number; r: number };

function findCell(rows: string[], target: string): Cell | null {
  for (let r = 0; r < rows.length; r++) {
    const c = rows[r].indexOf(target);
    if (c >= 0) return { c, r };
  }
  return null;
}

function shortestPathBetween(rows: string[], start: Cell, target: Cell): Cell[] {
  const key = (c: Cell): string => `${c.c},${c.r}`;
  const passable = (c: number, r: number): boolean => {
    if (r < 0 || c < 0 || r >= rows.length || c >= rows[0].length) return false;
    const cell = rows[r][c];
    return cell !== '1';
  };
  const queue: Array<Cell & { p?: Cell }> = [{ ...start }];
  const seen = new Set<string>([key(start)]);
  let found: (Cell & { p?: Cell }) | undefined;
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
  const path: Cell[] = [];
  let cur: (Cell & { p?: Cell }) | undefined = found;
  while (cur) {
    path.push({ c: cur.c, r: cur.r });
    cur = cur.p;
  }
  return path.reverse();
}

function routeToExit(level: LevelData): Cell[] {
  const rows = level.maze.rowsGrid;
  const start = findCell(rows, '2');
  const exit = findCell(rows, '3');
  if (!start || !exit) return [];
  return shortestPathBetween(rows, start, exit);
}

describe('levels', () => {
  it('defines expected progression count', () => {
    expect(LEVELS.length).toBe(7);
  });

  it('provides an intro level without key requirements', () => {
    const lvl = LEVELS[0];
    expect(lvl.sizeLabel).toBe('4x4');
    expect(lvl.requiresKey).toBe(false);
    expect(lvl.beacons.length).toBe(0);
  });

  it('introduces key before beacons, then a single beacon with key, then multiple', () => {
    const keyFirst = LEVELS[3];
    const beaconFirst = LEVELS[4];
    const later = LEVELS.slice(5, LEVELS.length - 1);
    expect(keyFirst.requiresKey).toBe(true);
    expect(keyFirst.key !== undefined).toBe(true);
    expect(keyFirst.beacons.length).toBe(0);
    expect(beaconFirst.requiresKey).toBe(true);
    expect(beaconFirst.key !== undefined).toBe(true);
    expect(beaconFirst.beacons.length).toBe(1);
    for (const lvl of later) {
      expect(lvl.requiresKey).toBe(true);
      expect(lvl.key !== undefined).toBe(true);
      expect(lvl.beacons.length).toBeGreaterThan(0);
    }
  });

  it('marks bonus hard mode limits', () => {
    const bonus = LEVELS[LEVELS.length - 1];
    expect(bonus.isBonus).toBe(true);
    expect(bonus.requiresKey).toBe(true);
    expect(bonus.beacons.length).toBe(3);
    expect(bonus.timeLimitSec).toBe(120);
    expect(bonus.pingLimit).toBe(12);
    expect(bonus.sizeLabel).toBe('25x25');
  });

  it('places beacons evenly along the path toward the exit', () => {
    for (const lvl of LEVELS) {
      if (lvl.beacons.length === 0) continue;
      const path = routeToExit(lvl);
      expect(path.length).toBeGreaterThan(2);
      const edges = path.length - 1;
      const startEdge = Math.min(edges - 1, Math.max(1, Math.floor(edges * 0.3)));
      const actualIndices = lvl.beacons.map((b) => path.findIndex((c) => c.c === b.cell.c && c.r === b.cell.r));
      for (const idx of actualIndices) {
        expect(idx).toBeGreaterThan(startEdge - 1);
        expect(idx).toBeLessThan(path.length - 1);
      }
      const expected: number[] = [];
      let lastIdx = startEdge;
      for (let i = 1; i <= lvl.beacons.length; i++) {
        const target = startEdge + (edges - startEdge) * (i / (lvl.beacons.length + 1));
        const idx = Math.max(lastIdx + 1, Math.min(path.length - 2, Math.round(target)));
        expected.push(idx);
        lastIdx = idx;
      }
      const expectedCells = expected.map((idx) => path[idx]);
      const actualCells = lvl.beacons.map((b) => b.cell);
      expect(actualCells).toEqual(expectedCells);
    }
  });
});
