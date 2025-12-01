import { describe, expect, it } from 'bun:test';
import { Material, type Wall } from '../materials';
import { gatherReflectionImages, type ReflectionImage, rebuildReflectionPlanes } from '../reflections';

const bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };

describe('gatherReflectionImages', () => {
  it('prefers nearest inner wall in the same span', () => {
    const walls: Wall[] = [{ cx: 2, cy: 1.2, cz: 0, hx: 0, hy: 1.2, hz: 1.0, mat: Material.INNER }];
    rebuildReflectionPlanes(walls);
    const imgs: ReflectionImage[] = [];
    const count = gatherReflectionImages({ x: 0, y: 1, z: 0 }, bounds, Material.OUTER.reflect, imgs, 4);
    expect(count).toBeGreaterThan(0);
    const right = imgs.find((im) => im.x > 0 && Math.abs(im.z) < 0.01);
    expect(right?.x).toBeCloseTo(4); // mirrored across x=2 wall
    expect(right?.reflect).toBeCloseTo(Material.INNER.reflect);
  });

  it('falls back to outer bounds if wall does not cover the position', () => {
    const walls: Wall[] = [{ cx: 2, cy: 1.2, cz: 0, hx: 0, hy: 1.2, hz: 1.0, mat: Material.INNER }];
    rebuildReflectionPlanes(walls);
    const imgs: ReflectionImage[] = [];
    const count = gatherReflectionImages({ x: 0, y: 1, z: 5 }, bounds, Material.OUTER.reflect, imgs, 4);
    expect(count).toBeGreaterThan(0);
    const right = imgs.find((im) => im.x > 0 && Math.abs(im.z - 5) < 0.01);
    expect(right?.x).toBeCloseTo(bounds.maxX * 2); // reflected by outer wall
    expect(right?.reflect).toBeCloseTo(Material.OUTER.reflect);
  });
});
