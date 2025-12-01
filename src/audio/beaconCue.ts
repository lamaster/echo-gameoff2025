import { MazeMeta, occlusionAtten } from '../materials';

type Vec2 = { x: number; z: number };

type OcclusionFn = (listener: Vec2, beacon: Vec2) => { gainMul: number };

export type BeaconCue = { pan: number; strength: number; bright: number };

const clampPan = (v: number): number => Math.max(-1, Math.min(1, v));

export function calcBeaconCue(
  listener: Vec2,
  rightX: number,
  rightZ: number,
  beaconPosition: Vec2,
  opts?: { reach?: number; occlusion?: OcclusionFn },
): BeaconCue | null {
  const reach = opts?.reach ?? MazeMeta.cellSize * 4.0;
  if (reach <= 0) return null;
  const dx = beaconPosition.x - listener.x;
  const dz = beaconPosition.z - listener.z;
  const distance = Math.hypot(dx, dz);
  if (distance > reach) return null;
  const pan = clampPan((dx * rightX + dz * rightZ) / Math.max(distance, 1e-4));
  const near = Math.max(0, 1 - distance / reach);
  const occlusion =
    opts?.occlusion?.(listener, beaconPosition) ?? occlusionAtten({ x: listener.x, z: listener.z }, beaconPosition);
  const occlusionMix = 0.55 + 0.45 * Math.max(0, Math.min(1, occlusion.gainMul));
  const strength = near * occlusionMix;
  if (strength <= 0.05) return null;
  const bright = 0.2 + 0.5 * near;
  return { pan, strength, bright };
}
