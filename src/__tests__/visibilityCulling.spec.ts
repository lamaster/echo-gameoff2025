import { describe, expect, it } from 'bun:test';
import { DEFAULT_FOV_Y, FAR, NEAR } from '../renderConfig';
import {
  buildCullingGrid,
  createCullingScratch,
  frustumContains,
  gatherVisibleInstances,
  type InstanceBounds,
} from '../rendering/visibilityCulling';

const tanHalfFovY = Math.tan(0.5 * DEFAULT_FOV_Y);

const baseView = {
  position: { x: 0, y: 1, z: 0 },
  yaw: 0,
  pitch: 0,
  aspect: 1,
  near: NEAR,
  far: FAR,
  tanHalfFovY,
};

function inst(
  center: { x: number; y: number; z: number },
  half: { x: number; y: number; z: number },
  materialId = 1,
  alwaysVisible = false,
): InstanceBounds {
  return { center, half, radius: Math.hypot(half.x, half.y, half.z), materialId, alwaysVisible };
}

describe('frustumContains', () => {
  it('rejects boxes behind the camera', () => {
    const behind = inst({ x: 0, y: 0, z: 5 }, { x: 0.5, y: 0.5, z: 0.5 });
    expect(frustumContains(behind, baseView)).toBe(false);
  });

  it('keeps boxes inside the forward frustum', () => {
    const forward = inst({ x: 0, y: 0.2, z: -3 }, { x: 0.75, y: 0.5, z: 0.75 });
    expect(frustumContains(forward, baseView)).toBe(true);
  });
});

describe('gatherVisibleInstances', () => {
  it('sorts visible instances front-to-back and drops frustum misses', () => {
    const instances = [
      inst({ x: 0, y: 0, z: -2 }, { x: 0.5, y: 0.5, z: 0.5 }), // closest
      inst({ x: 0, y: 0, z: -6 }, { x: 0.5, y: 0.5, z: 0.5 }), // farther
      inst({ x: 5, y: 0, z: -2 }, { x: 0.5, y: 0.5, z: 0.5 }), // outside FOV
    ];
    const grid = buildCullingGrid(instances, 1.0, { minX: -1, maxX: 6, minZ: -7, maxZ: 1 });
    const visible = gatherVisibleInstances(grid, instances, baseView);
    expect(visible).toEqual([0, 1]);
  });

  it('always keeps marked instances even when outside view tiles', () => {
    const instances = [
      inst({ x: 0, y: 0, z: -2 }, { x: 0.5, y: 0.5, z: 0.5 }),
      inst({ x: 8, y: 0, z: 8 }, { x: 1.0, y: 0.5, z: 1.0 }, 0, true),
    ];
    const grid = buildCullingGrid(instances, 1.0, { minX: -1, maxX: 9, minZ: -3, maxZ: 9 });
    const visible = gatherVisibleInstances(grid, instances, baseView);
    expect(visible.includes(1)).toBe(true);
    expect(visible.includes(0)).toBe(true);
  });

  it('supports scratch buffers for reuse', () => {
    const instances = [
      inst({ x: 0, y: 0, z: -2 }, { x: 0.5, y: 0.5, z: 0.5 }),
      inst({ x: 0, y: 0, z: -5 }, { x: 0.5, y: 0.5, z: 0.5 }),
    ];
    const grid = buildCullingGrid(instances, 1.0, { minX: -1, maxX: 1, minZ: -6, maxZ: 1 });
    const scratch = createCullingScratch(instances.length, grid);
    const first = gatherVisibleInstances(grid, instances, baseView, scratch);
    scratch.visible.push(99); // should be cleared on next call
    const second = gatherVisibleInstances(grid, instances, baseView, scratch);
    expect(second).toEqual(first);
  });
});
