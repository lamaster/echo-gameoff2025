import { describe, expect, it } from 'bun:test';
import {
  MazeBounds,
  MazeExit,
  MazeExitDoor,
  MazeMeta,
  MazeRows,
  MazeStart,
  occlusionAtten,
  segIntersectsAABB,
  Walls,
} from '../materials';

describe('segIntersectsAABB', () => {
  it('detects hits against inner wall slab', () => {
    const w = Walls[0];
    const a = { x: w.cx - w.hx * 2, z: w.cz };
    const b = { x: w.cx + w.hx * 2, z: w.cz };
    expect(segIntersectsAABB(a, b, w)).toBe(true);
  });

  it('returns false for degenerate segment', () => {
    expect(segIntersectsAABB({ x: 0, z: 0 }, { x: 0, z: 0 }, Walls[0])).toBe(false);
  });
});

describe('occlusionAtten', () => {
  it('keeps gain when path is clear', () => {
    const res = occlusionAtten({ x: MazeStart.x, z: MazeStart.z }, { x: MazeStart.x + 0.2, z: MazeStart.z + 0.2 });
    expect(res.hits).toBe(0);
    expect(res.gainMul).toBeCloseTo(1);
    expect(res.lpMul).toBeCloseTo(1);
  });

  it('attenuates when walls are crossed', () => {
    const res = occlusionAtten({ x: MazeStart.x, z: MazeStart.z }, { x: MazeExit.x, z: MazeExit.z });
    expect(res.hits).toBeGreaterThan(0);
    expect(res.gainMul).toBeLessThan(1);
    expect(res.lpMul).toBeLessThanOrEqual(1);
  });

  it('exposes bounds matching maze dimensions', () => {
    const spanX = MazeBounds.maxX - MazeBounds.minX;
    const spanZ = MazeBounds.maxZ - MazeBounds.minZ;
    expect(spanX).toBeCloseTo(MazeMeta.cols * MazeMeta.cellSize);
    expect(spanZ).toBeCloseTo(MazeMeta.rows * MazeMeta.cellSize);
  });

  it('provides oriented exit door inside maze bounds', () => {
    const nLen = Math.hypot(MazeExitDoor.normal.x, MazeExitDoor.normal.z);
    expect(nLen).toBeCloseTo(1);
    expect(MazeExitDoor.position.x).toBeGreaterThanOrEqual(MazeBounds.minX - 0.01);
    expect(MazeExitDoor.position.x).toBeLessThanOrEqual(MazeBounds.maxX + 0.01);
    expect(MazeExitDoor.position.z).toBeGreaterThanOrEqual(MazeBounds.minZ - 0.01);
    expect(MazeExitDoor.position.z).toBeLessThanOrEqual(MazeBounds.maxZ + 0.01);
  });

  it('keeps walls around exit door with an opening only in front', () => {
    let exit = { c: 0, r: 0 };
    for (let r = 0; r < MazeRows.length; r++) {
      const c = MazeRows[r].indexOf('3');
      if (c !== -1) {
        exit = { c, r };
        break;
      }
    }
    const d =
      MazeExitDoor.normal.z < -0.5
        ? { dc: 0, dr: -1 }
        : MazeExitDoor.normal.x > 0.5
          ? { dc: 1, dr: 0 }
          : MazeExitDoor.normal.z > 0.5
            ? { dc: 0, dr: 1 }
            : { dc: -1, dr: 0 };
    const front = MazeRows[exit.r + d.dr]?.[exit.c + d.dc];
    const left = MazeRows[exit.r + d.dc]?.[exit.c - d.dr];
    const right = MazeRows[exit.r - d.dc]?.[exit.c + d.dr];
    const back = MazeRows[exit.r - d.dr]?.[exit.c - d.dc];
    expect(front).not.toBe('1');
    expect(left).toBe('1');
    expect(right).toBe('1');
    expect(back).toBe('1');
  });
});
