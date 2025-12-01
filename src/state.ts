import { type Controller, createController } from './controller';
import type { BeaconData, LevelData } from './levels';
import { DEFAULT_FOV_DEG } from './renderConfig';
export const VISUAL_WAVE_C = 12.0;

export type UISettings = {
  echoMaster: number;
  echoGainMul: number;
  echoDistK: number;
  echoLPK: number;
  echoLPBase: number;
  unitMeters: number;
  ringFalloff: number;
  afterMix: number;
  avSync: number;
  delayBiasMs: number;
  echoFreq: number;
  pingClick: number;
  wavePing: number;
  waveJump: number;
  waveFootstep: number;
};

export type LevelResult = {
  id: number;
  name: string;
  timeSec: number;
  steps: number;
  jumps: number;
  pings: number;
  beacons: number;
  keyCollected: boolean;
  isBonus?: boolean;
  success: boolean;
};

export type BeaconState = BeaconData & { activated: boolean };

export type LevelRuntime = {
  data: LevelData;
  keyCollected: boolean;
  beacons: BeaconState[];
  pingUsed: number;
  steps: number;
  jumps: number;
  startTimeMs: number;
  timeLimitSec?: number;
  isTimerExpired: boolean;
};

export type ProgressState = {
  levelIndex: number;
  current?: LevelRuntime;
  results: LevelResult[];
  isFinished: boolean;
  totalSteps: number;
  totalJumps: number;
  totalTimeSec: number;
};

export type FlagsState = {
  debug: boolean;
  wire: boolean;
  heat: boolean;
  reflect: boolean;
  audioEcho: boolean;
  afterglow: boolean;
};

export type InputState = {
  keys: Record<string, boolean>;
  rotating: boolean;
  lastX: number;
  lastY: number;
  pointerLocked: boolean;
};

export type UIState = UISettings & {
  visible: boolean;
};

export type GameState = {
  start: number;
  controller: Controller;
  input: InputState;
  flags: FlagsState;
  isJumpQueued: boolean;
  ghost: number;
  outline: number;
  gridScale: number;
  gridWidth: number;
  doorGlow: number;
  fovDeg: number;
  pingPositions: Float32Array;
  pingTimes: Float32Array;
  pingCount: number;
  pingStrengths: Float32Array;
  pingRecharge: {
    charges: number;
    max: number;
    cooldownSec: number;
    accumulatedSeconds: number;
    lastUpdateSec: number;
    hasNotifiedDepleted: boolean;
  };
  ui: UIState;
  perf: {
    samples: number[]; // CPU ms
    samplesGpu: number[]; // GPU ms
    samplesMem: number[]; // MB
    head: number;
    shouldBlockOnFinish: boolean;
    memLimitMB: number;
  };
  tileWave?: {
    lastPingTime: number;
  };
  progress: ProgressState;
  finishScreen?: {
    isVisible: boolean;
    isFinal?: boolean;
  };
  footstep: {
    distanceSinceLastStep: number;
    interval: number;
  };
  exitCue: {
    lastKnock: number;
    interval: number;
    blockedCuePlayed: boolean;
  };
  beaconCue: {
    lastChime: number;
    interval: number;
  };
  audio?: {
    footstep: (gain?: number) => void;
    jump: () => void;
    land: () => void;
    exitKnock?: (intensity?: number, pan?: number) => void;
    doorBlocked?: () => void;
    keyPickup?: () => void;
    doorOpen?: () => void;
    beaconChime?: (pan?: number, bright?: number, gain?: number) => void;
    fail?: () => void;
    cooldownTick?: () => void;
  };
};

export function createState(): GameState {
  return {
    start: performance.now(),
    controller: createController(),
    input: {
      keys: Object.create(null) as Record<string, boolean>,
      rotating: false,
      lastX: 0,
      lastY: 0,
      pointerLocked: false,
    },
    flags: {
      debug: false,
      wire: false,
      heat: false,
      reflect: true,
      audioEcho: true,
      afterglow: true,
    },
    isJumpQueued: false,
    ghost: 0.22,
    outline: 0.72,
    gridScale: 2.8,
    gridWidth: 0.04,
    doorGlow: 1,
    fovDeg: DEFAULT_FOV_DEG,
    pingPositions: new Float32Array(10 * 3),
    pingTimes: new Float32Array(10),
    pingStrengths: new Float32Array(10).fill(1),
    pingCount: 0,
    pingRecharge: {
      charges: 10,
      max: 10,
      cooldownSec: 10,
      accumulatedSeconds: 0,
      lastUpdateSec: 0,
      hasNotifiedDepleted: false,
    },
    ui: {
      visible: false,
      echoMaster: 0.9,
      echoGainMul: 1.0,
      echoDistK: 0.05,
      echoLPK: 0.06,
      echoLPBase: 800,
      unitMeters: 3.0,
      ringFalloff: 0.4,
      afterMix: 0,
      avSync: 1,
      delayBiasMs: 0,
      echoFreq: 1400,
      pingClick: 0.6,
      wavePing: 1.5,
      waveJump: 1.0,
      waveFootstep: 0.35,
    },
    perf: {
      samples: new Array(64).fill(0),
      samplesGpu: new Array(64).fill(0),
      samplesMem: new Array(64).fill(0),
      head: 0,
      shouldBlockOnFinish: true,
      memLimitMB: 0,
    },
    progress: {
      levelIndex: 0,
      current: undefined,
      results: [],
      isFinished: false,
      totalSteps: 0,
      totalJumps: 0,
      totalTimeSec: 0,
    },
    finishScreen: { isVisible: false, isFinal: false },
    footstep: {
      distanceSinceLastStep: 0,
      interval: 1.2,
    },
    exitCue: {
      lastKnock: -1e9,
      interval: 3.5,
      blockedCuePlayed: false,
    },
    beaconCue: {
      lastChime: -1e9,
      interval: 4.5,
    },
  };
}
