import { describe, expect, it } from 'bun:test';
import {
  applyLookDelta,
  computeMovementDelta,
  createController,
  setControllerOrientation,
  setControllerRotationEnabled,
} from '../controller';

describe('controller', () => {
  it('moves forward along -Z with default yaw', () => {
    const controller = createController();
    const { deltaX, deltaZ } = computeMovementDelta(
      controller,
      { forward: true, backward: false, left: false, right: false, isRunning: false },
      1,
    );
    expect(deltaX).toBeCloseTo(0);
    expect(deltaZ).toBeCloseTo(-controller.config.walkSpeed);
  });

  it('moves along +X when yaw is +90°', () => {
    const controller = createController();
    setControllerOrientation(controller, Math.PI / 2, 0);
    const { deltaX, deltaZ } = computeMovementDelta(
      controller,
      { forward: true, backward: false, left: false, right: false, isRunning: false },
      1,
    );
    expect(deltaX).toBeCloseTo(controller.config.walkSpeed);
    expect(deltaZ).toBeCloseTo(0, 5);
  });

  it('clamps pitch and normalizes yaw', () => {
    const controller = createController();
    setControllerOrientation(controller, 4 * Math.PI, Math.PI); // wrap yaw, clamp pitch
    expect(controller.state.yaw).toBeCloseTo(0, 5);
    expect(controller.state.pitch).toBeLessThanOrEqual(controller.config.maxPitch + 1e-6);
  });

  it('only applies look deltas when rotation is enabled', () => {
    const controller = createController();
    applyLookDelta(controller, 10, 5);
    expect(controller.state.yaw).toBeCloseTo(0);
    expect(controller.state.pitch).toBeCloseTo(0);
    setControllerRotationEnabled(controller, true);
    applyLookDelta(controller, 10, -5);
    expect(controller.state.yaw).not.toBe(0);
    expect(controller.state.pitch).not.toBe(0);
  });
});
