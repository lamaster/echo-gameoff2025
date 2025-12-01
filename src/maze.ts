export const CellType = {
  Empty: 0,
  Wall: 1,
  Start: 2,
  Exit: 3,
} as const;
export type CellType = (typeof CellType)[keyof typeof CellType];

export type MazeGenOptions = {
  cols?: number;
  rows?: number;
  seed?: number;
  rowsGrid?: string[];
  extraConnectors?: number;
  forceOdd?: boolean;
};

function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, max: number): number {
  return Math.floor(rng() * max);
}

export function generateMazeRows(opts: MazeGenOptions = {}): string[] {
  if (opts.rowsGrid && opts.rowsGrid.length > 0) return opts.rowsGrid;
  // enforce odd dimensions to have walls separating cells
  const colsBase = Math.max(5, opts.cols ?? 21);
  const rowsBase = Math.max(5, opts.rows ?? 21);
  const cols = opts.forceOdd === false ? colsBase : colsBase | 1;
  const rows = opts.forceOdd === false ? rowsBase : rowsBase | 1;
  const rng = createRng(opts.seed ?? 1);
  // grid initialized as walls
  const grid: number[][] = Array.from({ length: rows }, () => Array(cols).fill(CellType.Wall));
  const dirs = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  const stack: Array<{ x: number; y: number }> = [];
  const start = { x: 1, y: 1 };
  grid[start.y][start.x] = CellType.Empty;
  stack.push(start);

  while (stack.length) {
    const cur = stack[stack.length - 1];
    const neighbors: Array<{ x: number; y: number; wx: number; wy: number }> = [];
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx * 2;
      const ny = cur.y + dy * 2;
      if (nx > 0 && nx < cols - 1 && ny > 0 && ny < rows - 1 && grid[ny][nx] === CellType.Wall) {
        neighbors.push({ x: nx, y: ny, wx: cur.x + dx, wy: cur.y + dy });
      }
    }
    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }
    const n = neighbors[randInt(rng, neighbors.length)];
    grid[n.wy][n.wx] = CellType.Empty;
    grid[n.y][n.x] = CellType.Empty;
    stack.push({ x: n.x, y: n.y });
  }

  // find farthest cell from start for exit
  const queue: Array<{ x: number; y: number; d: number }> = [{ x: start.x, y: start.y, d: 0 }];
  const seen = new Set<string>([`${start.x},${start.y}`]);
  let far = { x: start.x, y: start.y, d: 0 };
  while (queue.length) {
    const cur = queue.shift();
    if (!cur) break;
    if (cur.d > far.d) far = cur;
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const k = `${nx},${ny}`;
      if (nx <= 0 || nx >= cols - 1 || ny <= 0 || ny >= rows - 1) continue;
      if (grid[ny][nx] !== CellType.Empty) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ x: nx, y: ny, d: cur.d + 1 });
    }
  }

  const connectors = Math.max(0, opts.extraConnectors ?? 0);
  let opened = 0;
  let attempts = 0;
  while (opened < connectors && attempts < connectors * 12) {
    attempts++;
    const x = 1 + randInt(rng, cols - 2);
    const y = 1 + randInt(rng, rows - 2);
    if (grid[y][x] !== CellType.Wall) continue;
    const evenX = x % 2 === 0;
    const evenY = y % 2 === 0;
    if (evenX === evenY) continue;
    const left = grid[y][x - 1];
    const right = grid[y][x + 1];
    const up = grid[y - 1][x];
    const down = grid[y + 1][x];
    const horiz = evenX && left !== CellType.Wall && right !== CellType.Wall;
    const vert = evenY && up !== CellType.Wall && down !== CellType.Wall;
    if (!horiz && !vert) continue;
    grid[y][x] = CellType.Empty;
    opened++;
  }

  grid[start.y][start.x] = CellType.Start;
  grid[far.y][far.x] = CellType.Exit;

  return grid.map((row) => row.join(''));
}

export const MazeRows = generateMazeRows();

export type MazeData = {
  cols: number;
  rows: number;
  cellSize: number;
  walls: { cx: number; cy: number; cz: number; hx: number; hy: number; hz: number; mat: number; border: boolean }[];
  start: { x: number; y: number; z: number };
  exit: { x: number; y: number; z: number };
  rowsGrid: string[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
};

function compressWalls(rowsGrid: string[], cellSize: number): MazeData['walls'] {
  const rows = rowsGrid.length;
  const cols = rowsGrid[0].length;
  const cx0 = -0.5 * cols * cellSize;
  const cz0 = -0.5 * rows * cellSize;
  type Run = { c0: number; c1: number };
  const runsPerRow: Run[][] = [];
  for (let r = 0; r < rows; r++) {
    const line = rowsGrid[r];
    const rowRuns: Run[] = [];
    let c = 0;
    while (c < cols) {
      if (line[c] !== '1') {
        c++;
        continue;
      }
      const cStart = c;
      while (c < cols && line[c] === '1') c++;
      rowRuns.push({ c0: cStart, c1: c - 1 });
    }
    runsPerRow.push(rowRuns);
  }
  // Merge vertical runs with identical spans.
  const walls: MazeData['walls'] = [];
  let r = 0;
  while (r < rows) {
    const rowRuns = runsPerRow[r];
    for (const run of rowRuns) {
      let r2 = r + 1;
      while (r2 < rows) {
        const nextRun = runsPerRow[r2].find((rr) => rr.c0 === run.c0 && rr.c1 === run.c1);
        if (!nextRun) break;
        r2++;
      }
      const c0 = run.c0;
      const c1 = run.c1;
      const spanCols = c1 - c0 + 1;
      const spanRows = r2 - r;
      const width = spanCols * cellSize;
      const depth = spanRows * cellSize;
      const cx = cx0 + c0 * cellSize + width * 0.5;
      const cz = cz0 + r * cellSize + depth * 0.5;
      const isBorder = r === 0 || c0 === 0 || r2 === rows || c1 === cols - 1 || r2 === rows - 1;
      walls.push({
        cx,
        cy: 1.2,
        cz,
        hx: width * 0.5,
        hy: 1.2,
        hz: depth * 0.5,
        mat: isBorder ? 1 : 2,
        border: isBorder,
      });
      for (let rr = r; rr < r2; rr++) {
        runsPerRow[rr] = runsPerRow[rr].filter((rrun) => !(rrun.c0 === run.c0 && rrun.c1 === run.c1));
      }
    }
    r++;
  }
  return walls;
}

export function buildMaze(cellSize = 1.0, opts: MazeGenOptions = {}): MazeData {
  const rowsGrid = opts.rowsGrid && opts.rowsGrid.length > 0 ? opts.rowsGrid : generateMazeRows(opts);
  const rows = rowsGrid.length;
  const cols = rowsGrid[0].length;
  const cx0 = -0.5 * cols * cellSize;
  const cz0 = -0.5 * rows * cellSize;
  const walls: MazeData['walls'] = compressWalls(rowsGrid, cellSize);
  let start = { x: 0, y: 1.2, z: 0 };
  let exit = { x: 0, y: 1.2, z: 0 };

  for (let r = 0; r < rows; r++) {
    const line = rowsGrid[r];
    for (let c = 0; c < cols; c++) {
      const cell = Number(line[c]) as CellType;
      const worldX = cx0 + c * cellSize + cellSize * 0.5;
      const worldZ = cz0 + r * cellSize + cellSize * 0.5;
      if (cell === CellType.Start) {
        start = { x: worldX, y: 1.2, z: worldZ };
      } else if (cell === CellType.Exit) {
        exit = { x: worldX, y: 1.2, z: worldZ };
      }
    }
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const w of walls) {
    minX = Math.min(minX, w.cx - w.hx);
    maxX = Math.max(maxX, w.cx + w.hx);
    minZ = Math.min(minZ, w.cz - w.hz);
    maxZ = Math.max(maxZ, w.cz + w.hz);
  }
  const bounds = { minX, maxX, minZ, maxZ };
  return { cols, rows, cellSize, walls, start, exit, rowsGrid, bounds };
}

export function buildMazeFromRows(rowsGrid: string[], cellSize = 1.0): MazeData {
  return buildMaze(cellSize, { rowsGrid });
}
