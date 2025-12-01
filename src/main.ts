import './style.css';
import { calcBeaconCue, createAudio } from './audio';
import { setControllerOrientation, setControllerRotationEnabled } from './controller';
import { TOOLS_ENABLED } from './env';
import { bindInput } from './input';
import { getLevel, LEVELS } from './levels';
import { MazeExitDoor, MazeMeta, MazeRows, MazeStart, setMazeData } from './materials';
import { buildPanel } from './panel';
import { addPing, createPingEmitter } from './pings';
import { createRenderer } from './renderer';
import { createState, type GameState } from './state';

const canvas = document.getElementById('gl') as HTMLCanvasElement | null;
const panel = TOOLS_ENABLED ? (document.getElementById('panel') as HTMLElement | null) : null;
const perf = TOOLS_ENABLED ? (document.getElementById('perf') as HTMLCanvasElement | null) : null;
const mapCanvas = TOOLS_ENABLED ? (document.getElementById('map') as HTMLCanvasElement | null) : null;
const mapPanel = TOOLS_ENABLED ? (document.getElementById('map-panel') as HTMLElement | null) : null;
const introMenu = document.getElementById('intro-menu') as HTMLElement | null;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement | null;
const bonusTimer = document.getElementById('bonus-timer') as HTMLElement | null;
const keyHint = document.getElementById('key-hint') as HTMLElement | null;
const lockHint = document.getElementById('lock-hint') as HTMLElement | null;
const finishScreen = document.getElementById('finish-screen') as HTMLElement | null;
const finishTitle = document.getElementById('finish-title') as HTMLElement | null;
const finishStats = document.getElementById('finish-stats') as HTMLTableSectionElement | null;
const finishContinue = document.getElementById('finish-continue') as HTMLButtonElement | null;
const finishRestart = document.getElementById('finish-restart') as HTMLButtonElement | null;

if (!canvas || !introMenu || !startBtn) {
  throw new Error('Required DOM elements missing');
}

if (!TOOLS_ENABLED) {
  document.getElementById('panel')?.remove();
  document.getElementById('perf')?.remove();
  document.getElementById('map-panel')?.remove();
}

let hasStarted = false;
let state: GameState | null = null;
let renderer: ReturnType<typeof createRenderer> | null = null;
let emitPing: ((strength?: number) => void) | null = null;
let isLevelTransitioning = false;
let audioApi: ReturnType<typeof createAudio> | null = null;
let areOverlaysVisible = false;
let pendingNextLevel: number | null = null;

const setOverlayVisibility = (visible: boolean): void => {
  if (!TOOLS_ENABLED) {
    areOverlaysVisible = false;
    if (state) state.ui.visible = false;
    return;
  }
  areOverlaysVisible = visible;
  if (visible) {
    panel?.classList.remove('hidden-ui');
    perf?.classList.remove('hidden-ui');
    mapPanel?.classList.remove('hidden-ui');
  } else {
    panel?.classList.add('hidden-ui');
    perf?.classList.add('hidden-ui');
    mapPanel?.classList.add('hidden-ui');
  }
  if (state) state.ui.visible = visible;
};

setOverlayVisibility(false);

function resetPings(s: GameState): void {
  s.pingCount = 0;
  s.pingPositions.fill(0);
  s.pingTimes.fill(0);
  s.pingStrengths.fill(0);
  if (s.tileWave) s.tileWave.lastPingTime = -1;
}

function orientPlayer(faceExit: boolean): void {
  if (!state) return;
  const start = MazeStart;
  state.controller.state.position.x = start.x;
  state.controller.state.position.y = start.y;
  state.controller.state.position.z = start.z;
  if (faceExit) {
    const dx = MazeExitDoor.position.x - start.x;
    const dz = MazeExitDoor.position.z - start.z;
    setControllerOrientation(state.controller, Math.atan2(dx, -dz), state.controller.state.pitch);
    return;
  }
  const startCellPos = (() => {
    const rows = MazeRows.length;
    const cols = MazeRows[0].length;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (MazeRows[r][c] === '2') return { r, c };
      }
    }
    return { r: 0, c: 0 };
  })();
  const neighborDirs = [
    { dr: 0, dc: 1 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: -1, dc: 0 },
  ];
  const cellSize = MazeMeta.cellSize;
  const cx0 = -0.5 * MazeMeta.cols * cellSize;
  const cz0 = -0.5 * MazeMeta.rows * cellSize;
  const cellToWorld = (c: number, r: number): { x: number; z: number } => {
    return { x: cx0 + c * cellSize + cellSize * 0.5, z: cz0 + r * cellSize + cellSize * 0.5 };
  };
  for (const nd of neighborDirs) {
    const nr = startCellPos.r + nd.dr;
    const nc = startCellPos.c + nd.dc;
    if (nr < 0 || nc < 0 || nr >= MazeRows.length || nc >= MazeRows[0].length) continue;
    const cell = MazeRows[nr][nc];
    if (cell === '1') continue; // wall
    const target = cellToWorld(nc, nr);
    const dx = target.x - MazeStart.x;
    const dz = target.z - MazeStart.z;
    setControllerOrientation(state.controller, Math.atan2(dx, -dz), state.controller.state.pitch);
    break;
  }
}

const formatTimeMs = (ms: number): string => {
  const clamped = Math.max(0, Math.round(ms));
  const min = Math.floor(clamped / 60000);
  const sec = Math.floor((clamped % 60000) / 1000);
  const cs = Math.floor((clamped % 1000) / 10);
  const pad2 = (v: number): string => v.toString().padStart(2, '0');
  return `${pad2(min)}:${pad2(sec)}:${pad2(cs)}`;
};

function hideBonusTimer(): void {
  bonusTimer?.classList.add('hidden-ui');
}

function updateBonusTimer(nowMs?: number): void {
  if (!state || !bonusTimer) return;
  const cur = state.progress.current;
  if (!cur || !cur.data.isBonus || !cur.data.timeLimitSec) {
    hideBonusTimer();
    return;
  }
  const elapsedMs = Math.max(0, (nowMs ?? performance.now()) - cur.startTimeMs);
  const remaining = Math.max(0, cur.data.timeLimitSec * 1000 - elapsedMs);
  bonusTimer.textContent = formatTimeMs(remaining);
  bonusTimer.classList.remove('hidden-ui');
}

function hideFinishScreen(): void {
  if (finishScreen) finishScreen.classList.remove('visible');
  setKeyHintVisible(false);
  if (state) state.finishScreen = { isVisible: false, isFinal: false };
  isLevelTransitioning = false;
  pendingNextLevel = null;
}

function setKeyHintVisible(visible: boolean): void {
  if (!keyHint) return;
  if (visible) keyHint.classList.add('visible');
  else keyHint.classList.remove('visible');
}

function setLockHintVisible(visible: boolean): void {
  if (!lockHint) return;
  if (visible) lockHint.classList.add('visible');
  else lockHint.classList.remove('visible');
}

function showCompletionScreen(opts: {
  levelName: string;
  levelNumber: number;
  timeSec: number;
  steps: number;
  pings: number;
  isFinal: boolean;
  nextLevelIdx?: number;
}): void {
  if (!state) return;
  const timeLabel = formatTimeMs(opts.timeSec * 1000);
  if (finishTitle) finishTitle.textContent = opts.isFinal ? 'Run complete' : 'Level complete';
  if (finishStats) {
    const rows: [string, string][] = [
      ['Level', `${opts.levelNumber} (${opts.levelName})`],
      ['Time', timeLabel],
      ['Steps', `${opts.steps}`],
      ['Pings', `${opts.pings}`],
    ];
    finishStats.innerHTML = rows.map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`).join('');
  }
  if (finishContinue) {
    if (opts.isFinal) finishContinue.classList.add('hidden-ui');
    else finishContinue.classList.remove('hidden-ui');
  }
  if (finishRestart) finishRestart.textContent = opts.isFinal ? 'Restart run' : 'Restart level';
  if (finishScreen) finishScreen.classList.add('visible');
  hideBonusTimer();
  setLockHintVisible(false);
  pendingNextLevel = opts.isFinal ? null : (opts.nextLevelIdx ?? null);
  state.finishScreen = { isVisible: true, isFinal: opts.isFinal };
  if (document.exitPointerLock) document.exitPointerLock();
  state.input.rotating = false;
  setControllerRotationEnabled(state.controller, false);
  isLevelTransitioning = true;
}

function startLevel(levelIdx: number, opts: { resetRun?: boolean; skipReload?: boolean } = {}): void {
  if (!state) return;
  const level = getLevel(levelIdx);
  setMazeData(level.maze, { seed: level.id, label: level.name });
  hideFinishScreen();
  setKeyHintVisible(false);
  if (opts.resetRun) {
    state.progress.results = [];
    state.progress.totalSteps = 0;
    state.progress.totalJumps = 0;
    state.progress.totalTimeSec = 0;
    state.progress.isFinished = false;
    if (finishScreen) finishScreen.classList.remove('visible');
  }
  state.progress.levelIndex = levelIdx;
  state.progress.isFinished = false;
  const beacons = level.beacons.map((b) => ({ ...b, activated: false }));
  state.progress.current = {
    data: level,
    keyCollected: !level.requiresKey || !level.key,
    beacons,
    pingUsed: 0,
    steps: 0,
    jumps: 0,
    startTimeMs: performance.now(),
    timeLimitSec: level.timeLimitSec,
    isTimerExpired: false,
  };
  state.start = performance.now();
  resetPings(state);
  state.footstep.distanceSinceLastStep = 0;
  state.controller.state.verticalVelocity = 0;
  state.controller.state.isGrounded = true;
  orientPlayer(level.faceExit === true);
  state.exitCue.lastKnock = -1e9;
  state.exitCue.blockedCuePlayed = false;
  state.pingRecharge.charges = state.pingRecharge.max;
  state.pingRecharge.accumulatedSeconds = 0;
  state.pingRecharge.lastUpdateSec = 0;
  if (!opts.skipReload && renderer) renderer.reloadWorld();
  updateBonusTimer(state.progress.current.startTimeMs);
}

function completeLevel(): void {
  if (!state || !state.progress.current || isLevelTransitioning) return;
  const cur = state.progress.current;
  const now = performance.now();
  const timeSec = (now - cur.startTimeMs) / 1000;
  const lit = cur.beacons.filter((b) => b.activated).length;
  state.progress.results.push({
    id: cur.data.id,
    name: cur.data.name,
    timeSec,
    steps: cur.steps,
    jumps: cur.jumps,
    pings: cur.pingUsed,
    beacons: lit,
    keyCollected: cur.keyCollected,
    isBonus: cur.data.isBonus,
    success: true,
  });
  state.progress.totalSteps += cur.steps;
  state.progress.totalJumps += cur.jumps;
  state.progress.totalTimeSec += timeSec;
  const nextIdx = state.progress.levelIndex + 1;
  if (audioApi) audioApi.playDoorOpenSound();
  const isFinal = nextIdx >= LEVELS.length;
  if (isFinal) state.progress.isFinished = true;
  showCompletionScreen({
    levelName: cur.data.name,
    levelNumber: state.progress.levelIndex + 1,
    timeSec,
    steps: cur.steps,
    pings: cur.pingUsed,
    isFinal,
    nextLevelIdx: isFinal ? undefined : nextIdx,
  });
}

function restartLevel(reason: 'timer'): void {
  if (!state || !state.progress.current) return;
  if (audioApi?.playFailSound) audioApi.playFailSound();
  state.progress.current.isTimerExpired = reason === 'timer';
  startLevel(state.progress.levelIndex);
}

const handleFrame = (_dt: number, nowMs: number): void => {
  const s = state;
  if (!s || !s.progress.current) return;
  if (s.progress.isFinished) return;
  const nowSec = (nowMs - s.start) / 1000;
  const recharge = s.pingRecharge;
  const prevCharges = recharge.charges;
  const dt = Math.max(0, nowSec - recharge.lastUpdateSec);
  recharge.lastUpdateSec = nowSec;
  recharge.accumulatedSeconds += dt;
  while (recharge.accumulatedSeconds >= recharge.cooldownSec && recharge.charges < recharge.max) {
    recharge.charges++;
    recharge.accumulatedSeconds -= recharge.cooldownSec;
  }
  if (prevCharges === 0 && recharge.charges > 0) {
    recharge.hasNotifiedDepleted = false;
  }
  if (s.finishScreen?.isVisible) return;
  const cur = s.progress.current;
  const playerPosition = s.controller.state.position;
  updateBonusTimer(nowMs);
  let shouldShowKeyHint = false;
  if (cur.data.timeLimitSec && !cur.isTimerExpired) {
    const elapsed = (nowMs - cur.startTimeMs) / 1000;
    if (elapsed >= cur.data.timeLimitSec) {
      cur.isTimerExpired = true;
      restartLevel('timer');
      return;
    }
  }
  if (cur.data.key && !cur.keyCollected) {
    const dx = playerPosition.x - cur.data.key.position.x;
    const dz = playerPosition.z - cur.data.key.position.z;
    if (Math.hypot(dx, dz) < Math.max(0.35, MazeMeta.cellSize * 0.32)) {
      cur.keyCollected = true;
      if (audioApi?.playKeyPickupSound) audioApi.playKeyPickupSound();
      addPing(s, cur.data.key.position, nowSec, 0.6);
    }
  }
  for (const b of cur.beacons) {
    if (b.activated) continue;
    const dx = playerPosition.x - b.position.x;
    const dz = playerPosition.z - b.position.z;
    if (Math.hypot(dx, dz) < Math.max(0.5, MazeMeta.cellSize * 0.42)) {
      b.activated = true;
      if (audioApi?.playBeaconChime) {
        const rightX = Math.cos(s.controller.state.yaw);
        const rightZ = Math.sin(s.controller.state.yaw);
        const dist = Math.hypot(dx, dz) || 1;
        const pan = Math.max(-1, Math.min(1, (dx * rightX + dz * rightZ) / dist));
        audioApi.playBeaconChime(pan, 1);
      }
      addPing(s, b.position, nowSec, 0.45);
    }
  }
  const litBeacons = cur.beacons.filter((b) => b.activated);
  if (litBeacons.length > 0 && audioApi?.playBeaconChime) {
    const beaconChime = audioApi.playBeaconChime;
    if (nowSec - s.beaconCue.lastChime > s.beaconCue.interval) {
      const playerPositionForBeacon = s.controller.state.position;
      const rightX = Math.cos(s.controller.state.yaw);
      const rightZ = Math.sin(s.controller.state.yaw);
      let chimed = false;
      litBeacons.forEach((b) => {
        const cue = calcBeaconCue(playerPositionForBeacon, rightX, rightZ, b.position);
        if (!cue) return;
        beaconChime(cue.pan, cue.bright, cue.strength);
        addPing(s, b.position, nowSec, 0.4);
        chimed = true;
      });
      if (chimed) s.beaconCue.lastChime = nowSec;
    }
  }
  const exitPosition = MazeExitDoor.position;
  const exitDx = playerPosition.x - exitPosition.x;
  const exitDz = playerPosition.z - exitPosition.z;
  const exitDist = Math.hypot(exitDx, exitDz);
  const doorReach = Math.max(MazeMeta.cellSize * 0.45, MazeExitDoor.width * 0.6);
  const canExit = !cur.data.requiresKey || cur.keyCollected;
  if (exitDist < doorReach) {
    if (canExit) {
      s.exitCue.blockedCuePlayed = false;
      shouldShowKeyHint = false;
      completeLevel();
    } else if (s.audio?.exitKnock) {
      shouldShowKeyHint = true;
      if (!s.exitCue.blockedCuePlayed && s.audio.doorBlocked) {
        s.exitCue.blockedCuePlayed = true;
        s.exitCue.lastKnock = nowSec;
        s.audio.doorBlocked();
      }
    }
  } else {
    s.exitCue.blockedCuePlayed = false;
  }
  setKeyHintVisible(shouldShowKeyHint);
};

function makePingGuards(): {
  before: (nowSec: number) => boolean;
  after: (nowSec: number) => void;
} {
  return {
    before: (nowSec: number) => {
      if (!state || !state.progress.current) return true;
      const cur = state.progress.current;
      const recharge = state.pingRecharge;
      if (recharge.charges <= 0) {
        if (audioApi?.playCooldownTick && !recharge.hasNotifiedDepleted) {
          audioApi.playCooldownTick();
          recharge.hasNotifiedDepleted = true; // block repeat until charge returns
          const p = state.controller.state.position;
          addPing(state, { x: p.x, y: p.y, z: p.z }, nowSec, 0.001 * Math.max(0, state.ui.wavePing));
        }
        return false;
      }
      const limit = cur.data.pingLimit;
      if (limit && cur.pingUsed >= limit) {
        if (audioApi?.playFailSound) audioApi.playFailSound();
        return false;
      }
      recharge.charges = Math.max(0, recharge.charges - 1);
      recharge.accumulatedSeconds = 0;
      recharge.lastUpdateSec = nowSec;
      cur.pingUsed++;
      return true;
    },
    after: (nowSec: number) => {
      if (!state || !state.progress.current) return;
      const cur = state.progress.current;
      if (cur.beacons.length === 0) return;
      const p = state.controller.state.position;
      const rightX = Math.cos(state.controller.state.yaw);
      const rightZ = Math.sin(state.controller.state.yaw);
      for (const b of cur.beacons) {
        if (!b.activated) continue;
        const cue = calcBeaconCue(p, rightX, rightZ, b.position);
        if (!cue) continue;
        addPing(state, b.position, nowSec, 0.4);
        if (audioApi?.playBeaconChime) audioApi.playBeaconChime(cue.pan, cue.bright, cue.strength);
      }
    },
  };
}

const startGame = (): void => {
  if (hasStarted) return;
  hasStarted = true;
  introMenu.classList.add('hidden');

  state = createState();
  state.ui.visible = areOverlaysVisible;
  startLevel(0, { resetRun: true, skipReload: true });
  audioApi = createAudio(state);
  audioApi.ensureAC();
  const pingGuards = makePingGuards();
  emitPing = createPingEmitter(
    state,
    {
      playPingSound: audioApi.playPingSound,
      playEchoForPing: audioApi.playEchoForPing,
    },
    { beforeEmit: pingGuards.before, afterEmit: pingGuards.after },
  );
  state.audio = {
    footstep: audioApi.playFootstepSound,
    jump: audioApi.playJumpSound,
    land: audioApi.playLandSound,
    exitKnock: audioApi.playExitKnockSound,
    doorBlocked: audioApi.playDoorBlockedSound,
    keyPickup: audioApi.playKeyPickupSound,
    doorOpen: audioApi.playDoorOpenSound,
    beaconChime: audioApi.playBeaconChime,
    fail: audioApi.playFailSound,
    cooldownTick: audioApi.playCooldownTick,
  };

  renderer = createRenderer(canvas, perf, mapCanvas, state, { onFrame: handleFrame });
  const inputApi = bindInput(canvas, state, {
    emitPing: () => emitPing?.(1),
    queueJump: () => {
      if (state) state.isJumpQueued = true;
    },
    allowDebugHotkeys: TOOLS_ENABLED,
    onPointerLockChange: (locked) => {
      if (state) state.input.pointerLocked = locked;
      if (!state) return;
      const shouldShow =
        hasStarted && !locked && !state.finishScreen?.isVisible && introMenu.classList.contains('hidden');
      setLockHintVisible(shouldShow);
      if (locked) setKeyHintVisible(false);
    },
  });
  if (panel && TOOLS_ENABLED) {
    buildPanel(panel, state, {
      onMaster: (v) => audioApi?.setMasterGain(v),
    });
  }
  addEventListener('resize', renderer.resize);
  renderer.resize();

  addEventListener('keydown', (e) => {
    if (!hasStarted || !state) return;
    if (TOOLS_ENABLED && e.code === 'KeyB') {
      setOverlayVisibility(!areOverlaysVisible);
      e.preventDefault();
      return;
    }
    if (!TOOLS_ENABLED) return;
    if (!e.code.startsWith('Digit')) return;
    const num = Number(e.code.slice(5));
    if (!Number.isFinite(num)) return;
    const idx = num - 1;
    if (idx < 0 || idx >= LEVELS.length) return;
    startLevel(idx, { resetRun: true });
  });

  if (finishContinue) {
    finishContinue.addEventListener('click', () => {
      if (!state) return;
      const nextIdx = pendingNextLevel ?? state.progress.levelIndex + 1;
      if (!Number.isFinite(nextIdx) || nextIdx >= LEVELS.length) return;
      hideFinishScreen();
      startLevel(nextIdx);
      canvas.focus({ preventScroll: true });
      inputApi.requestPointerLock();
    });
  }

  if (finishRestart) {
    finishRestart.addEventListener('click', () => {
      if (!state) return;
      const wasFinal = state.finishScreen?.isFinal === true;
      const currentLevelIdx = state.progress.levelIndex;
      if (!wasFinal) {
        const lastResult = state.progress.results[state.progress.results.length - 1];
        if (lastResult && state.progress.current?.data.id === lastResult.id) {
          state.progress.results.pop();
          state.progress.totalSteps = Math.max(0, state.progress.totalSteps - lastResult.steps);
          state.progress.totalJumps = Math.max(0, state.progress.totalJumps - lastResult.jumps);
          state.progress.totalTimeSec = Math.max(0, state.progress.totalTimeSec - lastResult.timeSec);
        }
      }
      hideFinishScreen();
      state.progress.isFinished = false;
      startLevel(wasFinal ? 0 : currentLevelIdx, { resetRun: wasFinal });
      canvas.focus({ preventScroll: true });
      inputApi.requestPointerLock();
    });
  }

  canvas.focus({ preventScroll: true });
  inputApi.requestPointerLock();
  renderer.start();
};

startBtn.addEventListener('click', startGame);
