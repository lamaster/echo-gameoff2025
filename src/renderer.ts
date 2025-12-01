import { computeMovementDelta } from './controller';
import { drawMiniMap } from './map';
import { MazeExitDoor, MazeMeta, occlusionAtten } from './materials';
import { moveWithCollisions } from './physics';
import { addPing } from './pings';
import { FAR, NEAR } from './renderConfig';
import { createSceneRenderer } from './rendering/sceneRenderer';
import type { RenderContext } from './rendering/types';
import type { GameState } from './state';
import { createTileWave, injectPing, stepTileWave, uploadTileWave } from './tileWave';

type DisjointTimerExt = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};
type PendingGpuQuery = { query: WebGLQuery; label: 'scene' };

const clampFovDeg = (deg: number): number => Math.max(30, Math.min(110, deg));

function writeCameraRotation(yaw: number, pitch: number, out: Float32Array): void {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  out[0] = cy;
  out[1] = 0;
  out[2] = sy;
  out[3] = -sy * sp;
  out[4] = cp;
  out[5] = cy * sp;
  out[6] = -sy * cp;
  out[7] = -sp;
  out[8] = cy * cp;
}

function writeProjectionMatrix(out: Float32Array, width: number, height: number, fovY: number): void {
  const aspect = width / Math.max(1, height);
  const f = 1.0 / Math.tan(fovY * 0.5);
  out[0] = f / aspect;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = f;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = (FAR + NEAR) / (NEAR - FAR);
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[14] = (2 * FAR * NEAR) / (NEAR - FAR);
  out[15] = 0;
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  perfCanvas: HTMLCanvasElement | null,
  mapCanvas: HTMLCanvasElement | null,
  state: GameState,
  hooks: { onFrame?: (dt: number, nowMs: number) => void } = {},
): {
  start: () => void;
  resize: () => void;
  reloadWorld: () => void;
  gl: WebGL2RenderingContext;
} {
  const gl = canvas.getContext('webgl2', { antialias: false });
  if (!gl) throw new Error('WebGL2 required');

  let sceneRenderer = createSceneRenderer(gl, canvas, state);
  let tileWave = createTileWave(gl);
  state.tileWave = { lastPingTime: -1 };
  const cameraRotationMatrix = new Float32Array(9);
  const projectionMatrix = new Float32Array(16);
  const extTimer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as DisjointTimerExt | null;
  const gpuQueries: PendingGpuQuery[] = [];
  const perfCtx = perfCanvas ? perfCanvas.getContext('2d') : null;
  let lastFovY = (clampFovDeg(state.fovDeg) * Math.PI) / 180;
  let lastW = -1;
  let lastH = -1;
  writeProjectionMatrix(projectionMatrix, canvas.width || innerWidth, canvas.height || innerHeight, lastFovY);

  const resize = (): void => {
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    const targetW = Math.floor(innerWidth * dpr);
    const targetH = Math.floor(innerHeight * dpr);
    if (canvas.width === targetW && canvas.height === targetH) return;
    if (targetW === lastW && targetH === lastH) return;
    lastW = targetW;
    lastH = targetH;
    canvas.width = targetW;
    canvas.height = targetH;
    gl.viewport(0, 0, targetW, targetH);
    const fovY = (clampFovDeg(state.fovDeg) * Math.PI) / 180;
    writeProjectionMatrix(projectionMatrix, targetW, targetH, fovY);
    lastFovY = fovY;
    sceneRenderer.resize(targetW, targetH);
  };

  let lastDt = performance.now();
  let lastWaveMs = 0;
  let lastSceneMs = 0;
  let lastGpuMs = 0;
  let lastGpuSceneMs = 0;
  let lastDrawCount = 0;
  let lastCulledCount = 0;
  const renderContext: RenderContext = {
    timeSeconds: 0,
    width: canvas.width,
    height: canvas.height,
    cameraRotation: cameraRotationMatrix,
    projectionMatrix,
    afterglowMix: state.flags.afterglow ? state.ui.afterMix : 0,
    waveTexture: tileWave.tex,
    waveTextureWidth: tileWave.width,
    waveTextureHeight: tileWave.height,
    waveOriginX: tileWave.originX,
    waveOriginZ: tileWave.originZ,
    waveCellSize: tileWave.cellSize,
  };

  const beginGpuQuery = (label: PendingGpuQuery['label']): WebGLQuery | null => {
    if (!extTimer) return null;
    const q = gl.createQuery();
    if (!q) return null;
    gl.beginQuery(extTimer.TIME_ELAPSED_EXT, q);
    gpuQueries.push({ query: q, label });
    if (gpuQueries.length > 12) {
      const dropped = gpuQueries.shift();
      if (dropped) gl.deleteQuery(dropped.query);
    }
    return q;
  };

  const endGpuQuery = (q: WebGLQuery | null): void => {
    if (!q || !extTimer) return;
    gl.endQuery(extTimer.TIME_ELAPSED_EXT);
  };

  const pollGpuTime = (): void => {
    if (!extTimer || gpuQueries.length === 0) return;
    while (gpuQueries.length > 0) {
      const { query, label } = gpuQueries[0];
      const available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) as boolean;
      if (!available) break;
      const disjoint = gl.getParameter(extTimer.GPU_DISJOINT_EXT) as boolean;
      const ns = disjoint ? 0 : (gl.getQueryParameter(query, gl.QUERY_RESULT) as number) || 0;
      const ms = ns / 1e6;
      if (!disjoint) {
        if (label === 'scene') lastGpuSceneMs = ms;
        lastGpuMs = lastGpuSceneMs;
      }
      gl.deleteQuery(query);
      gpuQueries.shift();
    }
  };

  const renderPerf = (dtMs: number): void => {
    if (!perfCtx || !perfCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = perfCanvas.clientWidth || perfCanvas.width / dpr || 240;
    const ch = perfCanvas.clientHeight || perfCanvas.height / dpr || 160;
    const desiredW = cw * dpr;
    const desiredH = ch * dpr;
    if (perfCanvas.width !== desiredW || perfCanvas.height !== desiredH) {
      perfCanvas.width = desiredW;
      perfCanvas.height = desiredH;
    }
    const ctx = perfCtx;
    ctx.save();
    ctx.scale(dpr, dpr);
    const w = cw;
    const h = ch;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0c1220aa';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#9ef';
    ctx.font = '12px ui-monospace';
    ctx.textBaseline = 'top';
    const pad = 8;
    const lineH = 14;
    ctx.fillText('CPU/GPU frame', pad, pad - 2);
    ctx.fillText(`Frame: ${dtMs.toFixed(2)} ms (budget 16ms)`, pad, pad + lineH);
    const gpuLabel = `GPU Scene:${lastGpuSceneMs.toFixed(2)} ms`;
    ctx.fillText(
      `Scene: ${lastSceneMs.toFixed(2)} | Wave: ${lastWaveMs.toFixed(2)} | ${gpuLabel}`,
      pad,
      pad + lineH * 2,
    );
    ctx.fillText(`Afterglow: wave_tile (mix ${renderContext.afterglowMix.toFixed(2)})`, pad, pad + lineH * 3);

    const samples = state.perf.samples;
    const samplesGpu = state.perf.samplesGpu;
    const samplesMem = state.perf.samplesMem;
    const head = state.perf.head;
    samples[head] = dtMs;
    samplesGpu[head] = lastGpuMs;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    if (mem && typeof mem.usedJSHeapSize === 'number') {
      const usedMB = mem.usedJSHeapSize / 1048576;
      samplesMem[head] = usedMB;
      if (!state.perf.memLimitMB) state.perf.memLimitMB = mem.jsHeapSizeLimit / 1048576;
    }
    state.perf.head = (head + 1) % samples.length;

    const maxMs = 30;
    const budgetMs = 16;
    ctx.fillText(`Instances: ${lastDrawCount} drawn | culled ${lastCulledCount}`, pad, pad + lineH * 4);
    const barsX = pad;
    const barsY = pad + lineH * 5 + 4;
    const barsW = w - barsX * 2;
    const hMax = 50;
    const barCount = samples.length;
    const barGap = 2;
    const barWidth = Math.max(2, Math.floor((barsW - barGap * (barCount - 1)) / barCount));
    const budgetPos = barsY + hMax - (budgetMs / maxMs) * hMax;

    ctx.strokeStyle = '#8aa';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(barsX, budgetPos);
    ctx.lineTo(barsX + barsW, budgetPos);
    ctx.stroke();

    let x = barsX;
    for (let i = 0; i < barCount; i++) {
      const idx = (head + i) % barCount;
      const cpu = samples[idx];
      const gpu = samplesGpu[idx];
      const cpuH = Math.min(hMax, (Math.max(0, Math.min(maxMs, cpu)) / maxMs) * hMax);
      const gpuH = Math.min(hMax, (Math.max(0, Math.min(maxMs, gpu)) / maxMs) * hMax);
      ctx.fillStyle = '#f78ad0';
      ctx.fillRect(x, barsY + (hMax - gpuH), barWidth, gpuH);
      ctx.fillStyle = '#4fa3ff';
      ctx.fillRect(x, barsY + (hMax - cpuH), barWidth, cpuH);
      x += barWidth + barGap;
    }

    const statusY = barsY + hMax + 8;
    const statusH = 4;
    x = barsX;
    for (let i = 0; i < barCount; i++) {
      const idx = (head + i) % barCount;
      const cpu = samples[idx];
      const gpu = samplesGpu[idx];
      const total = cpu + gpu;
      const color = total > 16 ? '#ff6b6b' : total >= 10 ? '#f0c75e' : '#5fda7e';
      ctx.fillStyle = color;
      ctx.fillRect(x, statusY, barWidth, statusH);
      x += barWidth + barGap;
    }

    const memDisplayMax = 100;
    const memWarn = 50;
    const memNow = samplesMem[(head + samplesMem.length - 1) % samplesMem.length] || 0;
    const memLabelY = barsY + hMax + 16;
    ctx.fillStyle = '#9ef';
    ctx.fillText('JS Heap', barsX, memLabelY);
    const memBarY = memLabelY + 14;
    const memBarH = 40;
    x = barsX;
    for (let i = 0; i < barCount; i++) {
      const idx = (head + i) % barCount;
      const v = samplesMem[idx];
      const hVal = Math.min(memBarH, (Math.max(0, Math.min(memDisplayMax, v)) / memDisplayMax) * memBarH);
      const c = v > memWarn ? '#f0c75e' : '#5fda7e';
      ctx.fillStyle = c;
      ctx.fillRect(x, memBarY + (memBarH - hVal), barWidth, hVal);
      x += barWidth + barGap;
    }
    ctx.fillStyle = '#9ef';
    ctx.fillText(`JS Heap ${memNow.toFixed(1)} / ${memDisplayMax.toFixed(1)} MB`, barsX, memBarY + memBarH + 4);
    ctx.restore();
  };

  const moveDelta = { deltaX: 0, deltaZ: 0 };

  const readMovementInput = (dt: number): number => {
    if (!state.input.pointerLocked) return 0;
    const move = computeMovementDelta(
      state.controller,
      {
        forward: !!state.input.keys.keyw,
        backward: !!state.input.keys.keys,
        left: !!state.input.keys.keya,
        right: !!state.input.keys.keyd,
        isRunning: !!state.input.keys.shiftleft || !!state.input.keys.shiftright,
      },
      dt,
    );
    moveWithCollisions(state, move.deltaX, move.deltaZ, moveDelta);
    return Math.hypot(moveDelta.deltaX, moveDelta.deltaZ);
  };

  const handleJumpQueue = (timeSeconds: number, wasGrounded: boolean): void => {
    if (state.isJumpQueued && wasGrounded) {
      const controllerState = state.controller.state;
      controllerState.verticalVelocity = 4.5;
      controllerState.isGrounded = false;
      state.isJumpQueued = false;
      if (state.progress.current) state.progress.current.jumps++;
      addPing(state, controllerState.position, timeSeconds, 1.0 * Math.max(0, state.ui.waveJump));
      if (state.audio) state.audio.jump();
      return;
    }
    if (state.isJumpQueued) {
      state.isJumpQueued = false;
    }
  };

  const applyVerticalMotion = (dt: number, timeSeconds: number, wasGrounded: boolean): void => {
    const controllerState = state.controller.state;
    const gravity = -12.0;
    controllerState.verticalVelocity += gravity * dt;
    controllerState.position.y += controllerState.verticalVelocity * dt;
    const groundY = 1.2;
    if (controllerState.position.y <= groundY) {
      controllerState.position.y = groundY;
      if (!wasGrounded) {
        controllerState.isGrounded = true;
        controllerState.verticalVelocity = 0;
        addPing(state, controllerState.position, timeSeconds, 0.6 * Math.max(0, state.ui.waveJump));
        if (state.audio) state.audio.land();
      } else {
        controllerState.isGrounded = true;
      }
    } else {
      controllerState.isGrounded = false;
    }
  };

  const updateFootsteps = (moveDist: number, timeSeconds: number): void => {
    const controllerState = state.controller.state;
    if (controllerState.isGrounded && moveDist > 0.0001) {
      state.footstep.distanceSinceLastStep += moveDist;
      if (state.footstep.distanceSinceLastStep >= state.footstep.interval) {
        state.footstep.distanceSinceLastStep -= state.footstep.interval;
        if (state.progress.current) state.progress.current.steps++;
        addPing(state, controllerState.position, timeSeconds, 0.2 * Math.max(0, state.ui.waveFootstep));
        if (state.audio) state.audio.footstep(0.25);
      }
      return;
    }
    if (!controllerState.isGrounded) state.footstep.distanceSinceLastStep = 0;
  };

  const updateExitCue = (timeSeconds: number): void => {
    const controllerState = state.controller.state;
    const exitPos = MazeExitDoor.position;
    const exitDx = controllerState.position.x - exitPos.x;
    const exitDz = controllerState.position.z - exitPos.z;
    const exitDist = Math.hypot(exitDx, exitDz);
    const cur = state.progress.current;
    const doorReach = Math.max(MazeMeta.cellSize * 0.45, MazeExitDoor.width * 0.6);
    const blockedNearDoor = !!cur?.data.requiresKey && !cur.keyCollected && exitDist < doorReach;
    if (blockedNearDoor && state.exitCue.blockedCuePlayed) return;
    const cueReach = MazeMeta.cellSize * 8.0;
    if (exitDist >= cueReach || timeSeconds - state.exitCue.lastKnock < state.exitCue.interval) return;
    const near = Math.max(0, 1 - exitDist / cueReach);
    const rightX = Math.cos(controllerState.yaw);
    const rightZ = Math.sin(controllerState.yaw);
    const pan = Math.max(-1, Math.min(1, (exitDx * rightX + exitDz * rightZ) / Math.max(exitDist, 1e-4)));
    const occ = occlusionAtten(
      { x: controllerState.position.x, z: controllerState.position.z },
      { x: exitPos.x, z: exitPos.z },
    );
    const occMul = 0.55 + 0.45 * occ.gainMul;
    const strength = Math.max(0.2, near * occMul);
    if (state.audio?.exitKnock) state.audio.exitKnock(strength, pan);
    addPing(state, { x: exitPos.x, y: exitPos.y, z: exitPos.z }, timeSeconds, 0.35 + 0.4 * strength);
    state.exitCue.lastKnock = timeSeconds;
  };

  const updateWaveField = (dt: number): void => {
    if (!state.flags.afterglow || state.ui.afterMix <= 0) {
      lastWaveMs = 0;
      return;
    }
    const newestPing = state.pingCount > 0 ? state.pingTimes[0] : -1;
    if (state.tileWave && newestPing > state.tileWave.lastPingTime) {
      const strength = state.pingStrengths[0] || 0;
      if (strength > 0) {
        injectPing(tileWave, { x: state.pingPositions[0], z: state.pingPositions[2] }, strength);
      }
      state.tileWave.lastPingTime = newestPing;
    }
    const waveStart = performance.now();
    stepTileWave(tileWave, dt);
    uploadTileWave(gl, tileWave);
    lastWaveMs = performance.now() - waveStart;
  };

  const update = (nowMs: number): void => {
    const dt = Math.min(0.05, (nowMs - lastDt) / 1000);
    lastDt = nowMs;
    const moveDist = readMovementInput(dt);
    const timeSeconds = (nowMs - state.start) / 1000;
    const controllerState = state.controller.state;
    const prevGrounded = controllerState.isGrounded;
    handleJumpQueue(timeSeconds, prevGrounded);
    applyVerticalMotion(dt, timeSeconds, prevGrounded);
    updateFootsteps(moveDist, timeSeconds);
    updateExitCue(timeSeconds);
    updateWaveField(dt);
    if (hooks.onFrame) hooks.onFrame(dt, nowMs);
  };

  const render = (): void => {
    const t = (performance.now() - state.start) / 1000;
    if (!extTimer) {
      lastGpuSceneMs = 0;
      lastGpuMs = 0;
    }
    const desiredFovY = (clampFovDeg(state.fovDeg) * Math.PI) / 180;
    if (Math.abs(desiredFovY - lastFovY) > 1e-4) {
      writeProjectionMatrix(projectionMatrix, canvas.width, canvas.height, desiredFovY);
      lastFovY = desiredFovY;
    }
    writeCameraRotation(state.controller.state.yaw, state.controller.state.pitch, cameraRotationMatrix);
    renderContext.timeSeconds = t;
    renderContext.width = canvas.width;
    renderContext.height = canvas.height;
    renderContext.afterglowMix = state.flags.afterglow ? Math.max(0, Math.min(1, state.ui.afterMix)) : 0;
    renderContext.waveTexture = tileWave.tex;
    renderContext.waveTextureWidth = tileWave.width;
    renderContext.waveTextureHeight = tileWave.height;
    renderContext.waveOriginX = tileWave.originX;
    renderContext.waveOriginZ = tileWave.originZ;
    renderContext.waveCellSize = tileWave.cellSize;
    const gpuScene = beginGpuQuery('scene');
    const stats = sceneRenderer.render(renderContext);
    endGpuQuery(gpuScene);
    lastDrawCount = typeof stats.drawCount === 'number' ? stats.drawCount : 0;
    lastCulledCount = typeof stats.culledCount === 'number' ? stats.culledCount : 0;
    lastSceneMs = stats.sceneMilliseconds;
    lastGpuMs = lastGpuSceneMs;
  };

  if (sceneRenderer.tests) sceneRenderer.tests();
  const reloadWorld = (): void => {
    if (sceneRenderer.dispose) sceneRenderer.dispose();
    sceneRenderer = createSceneRenderer(gl, canvas, state);
    if (sceneRenderer.tests) sceneRenderer.tests();
    if (tileWave?.tex) {
      gl.deleteTexture(tileWave.tex);
    }
    tileWave = createTileWave(gl);
    state.tileWave = { lastPingTime: -1 };
  };

  const loop = (): void => {
    const frameStart = performance.now();
    update(frameStart);
    render();
    if (mapCanvas) drawMiniMap(mapCanvas, state);
    if (perfCtx && state.perf.shouldBlockOnFinish) {
      gl.finish();
    }
    pollGpuTime();
    const elapsed = performance.now() - frameStart;
    renderPerf(elapsed);
    requestAnimationFrame(loop);
  };

  return {
    start: (): void => {
      loop();
    },
    resize,
    reloadWorld,
    gl,
  };
}
