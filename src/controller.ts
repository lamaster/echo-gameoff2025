import type { Vec3 } from './types';

export type MovementInput = { forward: boolean; backward: boolean; left: boolean; right: boolean; isRunning: boolean };
export type MovementDelta = { deltaX: number; deltaZ: number };

export type ControllerConfig = {
  walkSpeed: number;
  runSpeed: number;
  yawSensitivity: number;
  pitchSensitivity: number;
  maxPitch: number;
};

export type ControllerState = {
  position: Vec3;
  yaw: number;
  pitch: number;
  isRotating: boolean;
  verticalVelocity: number;
  isGrounded: boolean;
};

export type Controller = {
  config: ControllerConfig;
  state: ControllerState;
};

const DEFAULT_CONTROLLER_CONFIG: ControllerConfig = {
  walkSpeed: 3,
  runSpeed: 5,
  yawSensitivity: 0.0025,
  pitchSensitivity: 0.002,
  maxPitch: Math.PI / 2 - 0.001,
};

export function createController(configOverrides: Partial<ControllerConfig> = {}): Controller {
  return {
    config: { ...DEFAULT_CONTROLLER_CONFIG, ...configOverrides },
    state: {
      position: { x: 0, y: 1.2, z: 4.8 },
      yaw: 0,
      pitch: 0,
      isRotating: false,
      verticalVelocity: 0,
      isGrounded: true,
    },
  };
}

export function setControllerRotationEnabled(controller: Controller, rotating: boolean): void {
  controller.state.isRotating = !!rotating;
}

export function setControllerOrientation(controller: Controller, yaw: number, pitch: number): void {
  controller.state.yaw = normalizeYaw(yaw);
  const clampedPitch = Math.max(-controller.config.maxPitch, Math.min(controller.config.maxPitch, pitch));
  controller.state.pitch = clampedPitch;
}

export function applyLookDelta(controller: Controller, deltaX: number, deltaY: number): void {
  if (!controller.state.isRotating) return;
  setControllerOrientation(
    controller,
    controller.state.yaw + deltaX * controller.config.yawSensitivity,
    controller.state.pitch - deltaY * controller.config.pitchSensitivity,
  );
}

export function computeMovementDelta(controller: Controller, input: MovementInput, deltaTime: number): MovementDelta {
  const yaw = controller.state.yaw;
  const forwardX = Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = Math.sin(yaw);
  let velocityX = 0;
  let velocityZ = 0;
  if (input.forward) {
    velocityX += forwardX;
    velocityZ += forwardZ;
  }
  if (input.backward) {
    velocityX -= forwardX;
    velocityZ -= forwardZ;
  }
  if (input.left) {
    velocityX -= rightX;
    velocityZ -= rightZ;
  }
  if (input.right) {
    velocityX += rightX;
    velocityZ += rightZ;
  }
  const magnitude = Math.hypot(velocityX, velocityZ);
  if (magnitude > 0) {
    velocityX /= magnitude;
    velocityZ /= magnitude;
  }
  const speed = input.isRunning ? controller.config.runSpeed : controller.config.walkSpeed;
  return { deltaX: velocityX * speed * deltaTime, deltaZ: velocityZ * speed * deltaTime };
}

function normalizeYaw(angle: number): number {
  const tau = Math.PI * 2;
  let wrapped = ((angle % tau) + tau) % tau;
  if (wrapped > Math.PI) wrapped -= tau;
  if (Math.abs(wrapped - Math.PI) < 1e-12) return -Math.PI;
  return wrapped;
}
