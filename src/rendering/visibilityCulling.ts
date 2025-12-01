import type { Vec3 } from '../types';

export type InstanceBounds = {
  center: Vec3;
  half: Vec3;
  radius: number;
  materialId: number;
  alwaysVisible?: boolean;
  disabled?: boolean;
  pivot?: Vec3;
};

export type CullingGrid = {
  cellSize: number;
  minX: number;
  minZ: number;
  cols: number;
  rows: number;
  cells: number[][];
  maxRadius: number;
};

export type CameraFrustum = {
  position: Vec3;
  yaw: number;
  pitch: number;
  aspect: number;
  near: number;
  far: number;
  tanHalfFovY: number;
};

export type CullingScratch = {
  visible: number[];
  seen: Uint8Array;
  visited: Uint8Array;
  queueX: number[];
  queueZ: number[];
  queueD: number[];
  depth: Float32Array;
};

const MAX_CULL_STEPS = 48;
const MAX_CULL_CELLS = 512;

function clampCell(v: number, max: number): number {
  return Math.min(max, Math.max(0, v));
}

function gridIndex(x: number, z: number, cols: number): number {
  return z * cols + x;
}

function buildBasis(yaw: number, pitch: number): { forward: Vec3; right: Vec3; up: Vec3 } {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const forward = { x: sy * cp, y: sp, z: -cy * cp };
  const right = { x: cy, y: 0, z: sy };
  const up = { x: -sy * sp, y: cp, z: cy * sp };
  return { forward, right, up };
}

export function buildCullingGrid(
  instances: InstanceBounds[],
  cellSize: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): CullingGrid {
  const clampedSize = Math.max(0.5, cellSize);
  const width = Math.max(bounds.maxX - bounds.minX, clampedSize);
  const depth = Math.max(bounds.maxZ - bounds.minZ, clampedSize);
  const cols = Math.max(1, Math.ceil(width / clampedSize));
  const rows = Math.max(1, Math.ceil(depth / clampedSize));
  const cells: number[][] = Array.from({ length: cols * rows }, () => []);
  let maxRadius = 0;
  instances.forEach((inst, idx) => {
    maxRadius = Math.max(maxRadius, inst.radius);
    if (inst.alwaysVisible) return;
    const minCellX = clampCell(Math.floor((inst.center.x - inst.half.x - bounds.minX) / clampedSize), cols - 1);
    const maxCellX = clampCell(Math.floor((inst.center.x + inst.half.x - bounds.minX) / clampedSize), cols - 1);
    const minCellZ = clampCell(Math.floor((inst.center.z - inst.half.z - bounds.minZ) / clampedSize), rows - 1);
    const maxCellZ = clampCell(Math.floor((inst.center.z + inst.half.z - bounds.minZ) / clampedSize), rows - 1);
    for (let z = minCellZ; z <= maxCellZ; z++) {
      for (let x = minCellX; x <= maxCellX; x++) {
        cells[gridIndex(x, z, cols)].push(idx);
      }
    }
  });
  return { cellSize: clampedSize, minX: bounds.minX, minZ: bounds.minZ, cols, rows, cells, maxRadius };
}

export function frustumContains(inst: InstanceBounds, view: CameraFrustum): boolean {
  const { forward, right, up } = buildBasis(view.yaw, view.pitch);
  const relX = inst.center.x - view.position.x;
  const relY = inst.center.y - view.position.y;
  const relZ = inst.center.z - view.position.z;
  const projZ = relX * forward.x + relY * forward.y + relZ * forward.z;
  const r = inst.radius;
  if (projZ + r < view.near || projZ - r > view.far) return false;
  if (projZ + r <= 0.0) return false;
  const projX = relX * right.x + relY * right.y + relZ * right.z;
  const projY = relX * up.x + relY * up.y + relZ * up.z;
  const tanHalfFovX = view.tanHalfFovY * view.aspect;
  if (Math.abs(projX) > r + (projZ + r) * tanHalfFovX) return false;
  if (Math.abs(projY) > r + (projZ + r) * view.tanHalfFovY) return false;
  return true;
}

export function createCullingScratch(instanceCount: number, grid: CullingGrid): CullingScratch {
  return {
    visible: [],
    seen: new Uint8Array(instanceCount),
    visited: new Uint8Array(grid.cols * grid.rows),
    queueX: [],
    queueZ: [],
    queueD: [],
    depth: new Float32Array(instanceCount),
  };
}

export function gatherVisibleInstances(
  grid: CullingGrid,
  instances: InstanceBounds[],
  view: CameraFrustum,
  scratch?: CullingScratch,
): number[] {
  const visible = scratch?.visible ?? [];
  const seen = scratch?.seen ?? new Uint8Array(instances.length);
  const { forward } = buildBasis(view.yaw, view.pitch);
  const depthCache = scratch?.depth ?? new Float32Array(instances.length);
  const visited = scratch?.visited ?? new Uint8Array(grid.cols * grid.rows);
  const queueX = scratch?.queueX ?? [];
  const queueZ = scratch?.queueZ ?? [];
  const queueD = scratch?.queueD ?? [];
  if (scratch) {
    visible.length = 0;
    seen.fill(0);
    depthCache.fill(0);
    visited.fill(0);
    queueX.length = 0;
    queueZ.length = 0;
    queueD.length = 0;
  }
  instances.forEach((inst, idx) => {
    if (inst.disabled) return;
    if (!inst.alwaysVisible) return;
    visible.push(idx);
    seen[idx] = 1;
    const dx = inst.center.x - view.position.x;
    const dy = inst.center.y - view.position.y;
    const dz = inst.center.z - view.position.z;
    depthCache[idx] = dx * forward.x + dy * forward.y + dz * forward.z;
  });
  const startCellX = clampCell(Math.floor((view.position.x - grid.minX) / grid.cellSize), grid.cols - 1);
  const startCellZ = clampCell(Math.floor((view.position.z - grid.minZ) / grid.cellSize), grid.rows - 1);
  queueX.push(startCellX);
  queueZ.push(startCellZ);
  queueD.push(0);
  visited[gridIndex(startCellX, startCellZ, grid.cols)] = 1;
  const maxSteps = Math.min(Math.ceil((view.far + grid.maxRadius) / grid.cellSize) + 1, MAX_CULL_STEPS);
  for (let qi = 0; qi < queueX.length; qi++) {
    const cx = queueX[qi];
    const cz = queueZ[qi];
    const dist = queueD[qi];
    if (dist > maxSteps) continue;
    const cell = grid.cells[gridIndex(cx, cz, grid.cols)];
    for (let i = 0; i < cell.length; i++) {
      const idx = cell[i];
      if (instances[idx].disabled) continue;
      if (seen[idx]) continue;
      const inst = instances[idx];
      if (!frustumContains(inst, view)) continue;
      visible.push(idx);
      seen[idx] = 1;
      const dx = inst.center.x - view.position.x;
      const dy = inst.center.y - view.position.y;
      const dz = inst.center.z - view.position.z;
      depthCache[idx] = dx * forward.x + dy * forward.y + dz * forward.z;
    }
    if (dist >= maxSteps) continue;
    const nd = dist + 1;
    const maybePush = (nx: number, nz: number): void => {
      if (nx < 0 || nz < 0 || nx >= grid.cols || nz >= grid.rows) return;
      const gi = gridIndex(nx, nz, grid.cols);
      if (visited[gi]) return;
      visited[gi] = 1;
      queueX.push(nx);
      queueZ.push(nz);
      queueD.push(nd);
    };
    maybePush(cx + 1, cz);
    maybePush(cx - 1, cz);
    maybePush(cx, cz + 1);
    maybePush(cx, cz - 1);
    if (queueX.length > MAX_CULL_CELLS) break;
  }
  visible.sort((a, b) => depthCache[a] - depthCache[b]);
  return visible;
}
