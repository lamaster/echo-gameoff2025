import type { Wall } from './materials';
import type { Vec3 } from './types';

type ReflectionPlane = { pos: number; span0: number; span1: number; reflect: number };
type PlaneDir = 1 | -1;

const planesX: ReflectionPlane[] = [];
const planesZ: ReflectionPlane[] = [];
const EPS = 1e-4;

export type ReflectionImage = { x: number; y: number; z: number; reflect: number; distance: number };

export function rebuildReflectionPlanes(walls: Wall[]): void {
  planesX.length = 0;
  planesZ.length = 0;
  for (const w of walls) {
    const reflect = w.mat?.reflect ?? 0.5;
    const minZ = w.cz - w.hz;
    const maxZ = w.cz + w.hz;
    const minX = w.cx - w.hx;
    const maxX = w.cx + w.hx;
    planesX.push({ pos: minX, span0: minZ, span1: maxZ, reflect });
    planesX.push({ pos: maxX, span0: minZ, span1: maxZ, reflect });
    planesZ.push({ pos: minZ, span0: minX, span1: maxX, reflect });
    planesZ.push({ pos: maxZ, span0: minX, span1: maxX, reflect });
  }
}

function findPlane(
  planes: ReflectionPlane[],
  coord: number,
  ortho: number,
  dir: PlaneDir,
): { pos: number; reflect: number; dist: number } | null {
  let best: { pos: number; reflect: number; dist: number } | null = null;
  for (const p of planes) {
    if (ortho < p.span0 - EPS || ortho > p.span1 + EPS) continue;
    const dist = dir > 0 ? p.pos - coord : coord - p.pos;
    if (dist <= EPS) continue;
    if (!best || dist < best.dist) {
      best = { pos: p.pos, reflect: p.reflect, dist };
    }
  }
  return best;
}

export function gatherReflectionImages(
  src: Vec3,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  outerReflect: number,
  out: ReflectionImage[],
  maxCount: number,
): number {
  let count = 0;
  const push = (x: number, z: number, reflect: number, dist: number): void => {
    if (count >= maxCount) return;
    let slot = out[count];
    if (!slot) {
      slot = { x: 0, y: 0, z: 0, reflect: 0, distance: 0 };
      out[count] = slot;
    }
    slot.x = x;
    slot.y = src.y;
    slot.z = z;
    slot.reflect = reflect;
    slot.distance = dist;
    count++;
  };
  const dirs = [
    { axis: 'x' as const, dir: 1 as PlaneDir, fallback: bounds.maxX },
    { axis: 'x' as const, dir: -1 as PlaneDir, fallback: bounds.minX },
    { axis: 'z' as const, dir: 1 as PlaneDir, fallback: bounds.maxZ },
    { axis: 'z' as const, dir: -1 as PlaneDir, fallback: bounds.minZ },
  ];
  for (const d of dirs) {
    if (count >= maxCount) break;
    const coord = d.axis === 'x' ? src.x : src.z;
    const ortho = d.axis === 'x' ? src.z : src.x;
    const planes = d.axis === 'x' ? planesX : planesZ;
    const hit = findPlane(planes, coord, ortho, d.dir);
    const pos = hit ? hit.pos : d.fallback;
    const dist = hit ? hit.dist : Math.abs(pos - coord);
    const reflect = hit ? hit.reflect : outerReflect;
    const mx = d.axis === 'x' ? pos * 2 - src.x : src.x;
    const mz = d.axis === 'z' ? pos * 2 - src.z : src.z;
    push(mx, mz, reflect, dist);
  }
  return count;
}
