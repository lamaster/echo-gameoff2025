import { describe, expect, it } from 'bun:test';
import { calcBeaconCue } from '../audio/beaconCue';

const stubOcclusion =
  (gainMul: number) =>
  (_listener: { x: number; z: number }, _beacon: { x: number; z: number }): { gainMul: number } => {
    return { gainMul };
  };

describe('calcBeaconCue', () => {
  it('returns null when beacon is outside reach', () => {
    const cue = calcBeaconCue({ x: 0, z: 0 }, 1, 0, { x: 5, z: 0 }, { reach: 4, occlusion: stubOcclusion(1) });
    expect(cue).toBe(null);
  });

  it('attenuates strength by distance and occlusion', () => {
    const near = calcBeaconCue({ x: 0, z: 0 }, 1, 0, { x: 1, z: 0 }, { reach: 4, occlusion: stubOcclusion(1) });
    const far = calcBeaconCue({ x: 0, z: 0 }, 1, 0, { x: 3, z: 0 }, { reach: 4, occlusion: stubOcclusion(1) });
    if (!near || !far) throw new Error('expected cues for distance falloff');
    expect(near.strength).toBeGreaterThan(far.strength);
    expect(near.pan).toBeCloseTo(1, 3);

    const occluded = calcBeaconCue({ x: 0, z: 0 }, 1, 0, { x: 1, z: 0 }, { reach: 4, occlusion: stubOcclusion(0.3) });
    if (!occluded) throw new Error('expected occluded cue');
    expect(occluded.strength).toBeLessThan(near.strength);
  });
});
