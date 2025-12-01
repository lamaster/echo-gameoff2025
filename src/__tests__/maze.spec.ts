import { describe, expect, it } from 'bun:test';
import { MazeMeta } from '../materials';
import { buildMaze, MazeRows } from '../maze';

function countWallCells(rows: string[]): number {
  return rows.reduce((acc, row) => acc + row.split('').filter((c) => c === '1').length, 0);
}

describe('maze generation and compression', () => {
  it('compresses wall cells into fewer boxes', () => {
    const wallsRaw = countWallCells(MazeRows);
    const maze = buildMaze(MazeMeta.cellSize, { seed: 1, cols: MazeRows[0].length, rows: MazeRows.length });
    expect(maze.walls.length).toBeLessThan(wallsRaw);
    expect(maze.walls.length).toBeGreaterThan(0);
  });

  it('has start/exit on empty cells', () => {
    const maze = buildMaze();
    const startCell =
      MazeRows[Math.round((maze.start.z + maze.rows * maze.cellSize * 0.5 - maze.cellSize * 0.5) / maze.cellSize)]?.[
        Math.round((maze.start.x + maze.cols * maze.cellSize * 0.5 - maze.cellSize * 0.5) / maze.cellSize)
      ];
    const exitCell =
      MazeRows[Math.round((maze.exit.z + maze.rows * maze.cellSize * 0.5 - maze.cellSize * 0.5) / maze.cellSize)]?.[
        Math.round((maze.exit.x + maze.cols * maze.cellSize * 0.5 - maze.cellSize * 0.5) / maze.cellSize)
      ];
    expect(startCell).not.toBe('1');
    expect(exitCell).not.toBe('1');
  });

  it('uses enlarged default grid and cell size', () => {
    expect(MazeRows[0].length).toBeGreaterThanOrEqual(21);
    expect(MazeRows.length).toBeGreaterThanOrEqual(21);
    expect(MazeMeta.cellSize).toBeCloseTo(1.2);
  });
});
