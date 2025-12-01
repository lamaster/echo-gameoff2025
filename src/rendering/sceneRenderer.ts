import { linkProgram } from '../glHelpers';
import { Material, MazeBounds, MazeExitDoor, MazeMeta, Walls } from '../materials';
import { FAR, NEAR } from '../renderConfig';
import { FS_GEO, VS_GEO } from '../shaders';
import type { GameState } from '../state';
import type { RenderContext, RenderStats, SceneRenderer } from './types';
import {
  buildCullingGrid,
  createCullingScratch,
  gatherVisibleInstances,
  type InstanceBounds,
} from './visibilityCulling';

const cubeVerts = new Float32Array([
  // +X
  1, -1, -1, 1, 0, 0, 1, 1, -1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, -1, -1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, -1, 1, 1, 0, 0,
  // -X
  -1, -1, 1, -1, 0, 0, -1, 1, 1, -1, 0, 0, -1, 1, -1, -1, 0, 0, -1, -1, 1, -1, 0, 0, -1, 1, -1, -1, 0, 0, -1, -1, -1,
  -1, 0, 0,
  // +Y
  -1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, -1, 0, 1, 0, -1, 1, 1, 0, 1, 0, 1, 1, -1, 0, 1, 0, -1, 1, -1, 0, 1, 0,
  // -Y
  -1, -1, -1, 0, -1, 0, 1, -1, -1, 0, -1, 0, 1, -1, 1, 0, -1, 0, -1, -1, -1, 0, -1, 0, 1, -1, 1, 0, -1, 0, -1, -1, 1, 0,
  -1, 0,
  // +Z
  1, -1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, -1, 1, 1, 0, 0, 1, 1, -1, 1, 0, 0, 1, -1, 1, 1, 0, 0, 1, -1, -1, 1, 0, 0, 1,
  // -Z
  -1, -1, -1, 0, 0, -1, -1, 1, -1, 0, 0, -1, 1, 1, -1, 0, 0, -1, -1, -1, -1, 0, 0, -1, 1, 1, -1, 0, 0, -1, 1, -1, -1, 0,
  0, -1,
]);

type SceneUniforms = {
  timeSeconds: WebGLUniformLocation;
  cameraPosition: WebGLUniformLocation;
  cameraRotation: WebGLUniformLocation;
  projectionMatrix: WebGLUniformLocation;
  debugToggle: WebGLUniformLocation;
  ghostAmount: WebGLUniformLocation;
  outlineAmount: WebGLUniformLocation;
  wireframeToggle: WebGLUniformLocation;
  gridScale: WebGLUniformLocation;
  gridWidth: WebGLUniformLocation;
  heatToggle: WebGLUniformLocation;
  reflectionsToggle: WebGLUniformLocation;
  ringFalloff: WebGLUniformLocation;
  doorGlow: WebGLUniformLocation;
  pingCount: WebGLUniformLocation;
  pingPositions: WebGLUniformLocation;
  pingTimes: WebGLUniformLocation;
  pingStrengths: WebGLUniformLocation;
  mazeBounds: WebGLUniformLocation;
  afterglowMix: WebGLUniformLocation;
  waveTexture: WebGLUniformLocation;
  waveTextureSize: WebGLUniformLocation;
  waveOrigin: WebGLUniformLocation;
  waveCellSize: WebGLUniformLocation;
};

const INSTANCE_FLOATS = 10;

function makeUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): SceneUniforms {
  const get = (name: string): WebGLUniformLocation => {
    const loc = gl.getUniformLocation(program, name);
    if (!loc) throw new Error(`Missing uniform ${name}`);
    return loc;
  };
  return {
    timeSeconds: get('uTimeSeconds'),
    cameraPosition: get('uCameraPosition'),
    cameraRotation: get('uCameraRotation'),
    projectionMatrix: get('uProjectionMatrix'),
    debugToggle: get('uDebug'),
    ghostAmount: get('uGhost'),
    outlineAmount: get('uOutline'),
    wireframeToggle: get('uWire'),
    gridScale: get('uGridScale'),
    gridWidth: get('uGridWidth'),
    heatToggle: get('uHeat'),
    reflectionsToggle: get('uReflect'),
    ringFalloff: get('uRingFalloff'),
    doorGlow: get('uDoorGlow'),
    pingCount: get('uPingCount'),
    pingPositions: get('uPingPositions[0]'),
    pingTimes: get('uPingTimes[0]'),
    pingStrengths: get('uPingStrengths[0]'),
    mazeBounds: get('uMazeBounds'),
    afterglowMix: get('uAfterglowMix'),
    waveTexture: get('uWaveTexture'),
    waveTextureSize: get('uWaveTextureSize'),
    waveOrigin: get('uWaveOrigin'),
    waveCellSize: get('uWaveCellSize'),
  };
}

export function createSceneRenderer(
  gl: WebGL2RenderingContext,
  _canvas: HTMLCanvasElement,
  state: GameState,
): SceneRenderer {
  const program = linkProgram(gl, VS_GEO, FS_GEO);
  const u = makeUniforms(gl, program);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const instances: InstanceBounds[] = [];
  const defaultHalf: { x: number; y: number; z: number }[] = [];
  const pushInstance = (inst: InstanceBounds): number => {
    const idx = instances.length;
    instances.push(inst);
    defaultHalf[idx] = { x: inst.half.x, y: inst.half.y, z: inst.half.z };
    return idx;
  };
  const keyIndices: number[] = [];
  const beaconCapIndices: number[] = [];
  const beaconCapMap: number[] = [];

  for (const w of Walls) {
    minX = Math.min(minX, w.cx - w.hx);
    maxX = Math.max(maxX, w.cx + w.hx);
    minZ = Math.min(minZ, w.cz - w.hz);
    maxZ = Math.max(maxZ, w.cz + w.hz);
    pushInstance({
      center: { x: w.cx, y: w.cy, z: w.cz },
      half: { x: w.hx, y: w.hy, z: w.hz },
      radius: Math.hypot(w.hx, w.hy, w.hz),
      materialId: w.mat.id,
    });
  }
  const margin = 0.5;
  const baseHx = 0.5 * (maxX - minX) + margin;
  const baseHz = 0.5 * (maxZ - minZ) + margin;
  const centerX = 0.5 * (minX + maxX);
  const centerZ = 0.5 * (minZ + maxZ);
  pushInstance({
    center: { x: centerX, y: -0.05, z: centerZ },
    half: { x: baseHx, y: 0.08, z: baseHz },
    radius: Math.hypot(baseHx, 0.08, baseHz),
    materialId: 0,
    alwaysVisible: true,
  });
  const doorHy = 1.2;
  const doorWidth = MazeExitDoor.width * 0.5;
  const doorDepth = MazeExitDoor.depth * 0.5;
  const doorNormal = MazeExitDoor.normal;
  const doorHalf =
    Math.abs(doorNormal.x) > 0.5
      ? { x: doorDepth, y: doorHy, z: doorWidth }
      : { x: doorWidth, y: doorHy, z: doorDepth };
  pushInstance({
    center: {
      x: MazeExitDoor.position.x,
      y: MazeExitDoor.position.y + 0.1,
      z: MazeExitDoor.position.z,
    },
    half: doorHalf,
    radius: Math.hypot(doorHalf.x, doorHalf.y, doorHalf.z),
    materialId: Material.DOOR.id,
  });
  const tang = { x: -doorNormal.z, z: doorNormal.x };
  const handleWidth = MazeMeta.cellSize * 0.08;
  const handleDepth = MazeMeta.cellSize * 0.05;
  const handleHalf =
    Math.abs(doorNormal.x) > 0.5
      ? { x: handleDepth * 0.5, y: 0.08, z: handleWidth * 0.5 }
      : { x: handleWidth * 0.5, y: 0.08, z: handleDepth * 0.5 };
  const handleOffsetN = (Math.abs(doorNormal.x) > 0.5 ? doorHalf.x + handleHalf.x : doorHalf.z + handleHalf.z) + 0.02;
  const handleOffsetT = Math.max(0.12, MazeMeta.cellSize * 0.18);
  const handlePos = {
    x: MazeExitDoor.position.x + doorNormal.x * handleOffsetN + tang.x * handleOffsetT,
    y: MazeExitDoor.position.y + 0.1 - handleHalf.y,
    z: MazeExitDoor.position.z + doorNormal.z * handleOffsetN + tang.z * handleOffsetT,
  };
  pushInstance({
    center: handlePos,
    half: handleHalf,
    radius: Math.hypot(handleHalf.x, handleHalf.y, handleHalf.z),
    materialId: Material.METAL.id,
  });
  pushInstance({
    center: { x: centerX, y: 2.45, z: centerZ },
    half: { x: baseHx, y: 0.08, z: baseHz },
    radius: Math.hypot(baseHx, 0.08, baseHz),
    materialId: 0,
    alwaysVisible: true,
  });

  const level = state.progress.current;
  if (level?.data.key) {
    const k = level.data.key.position;
    const playerHeight = 1.8;
    const keyHeight = playerHeight * 0.5;
    const keyPivot = { x: k.x, y: keyHeight, z: k.z };
    const thickness = Math.max(0.006, MazeMeta.cellSize * 0.045);
    const rowH = MazeMeta.cellSize * 0.05;
    const yBase = keyPivot.y;
    const baseLen = MazeMeta.cellSize * 0.34;
    const lenShort = baseLen * 0.45;
    const lenLong = baseLen * 1.1;
    const toothLen = baseLen * 0.15;
    const toothGap = baseLen * 0.08;
    const xStart = k.x - baseLen * 0.55;
    const pushKeyPart = (cx: number, cy: number, hx: number, hy: number): void => {
      const half = { x: hx, y: hy, z: thickness * 0.5 };
      const idx = pushInstance({
        center: { x: cx, y: cy, z: keyPivot.z },
        half,
        radius: Math.hypot(half.x, half.y, half.z),
        materialId: Material.KEY.id,
        pivot: keyPivot,
      });
      keyIndices.push(idx);
    };
    const rowY = (row: number): number => yBase + (2 - row) * rowH;
    // Silhouette (side view, each char = same width):
    // ████████
    // ████████
    // ██████████████████████
    // ████████       █  █  █
    // ████████       █  █  █
    for (let r = 0; r < 2; r++) {
      const len = lenShort;
      pushKeyPart(xStart + len * 0.5, rowY(r), len * 0.5, rowH * 0.5);
    }
    pushKeyPart(xStart + lenLong * 0.5, rowY(2), lenLong * 0.5, rowH * 0.5);
    for (let r = 3; r < 5; r++) {
      const y = rowY(r);
      const headLen = lenShort;
      pushKeyPart(xStart + headLen * 0.5, y, headLen * 0.5, rowH * 0.5);
      const t0 = xStart + headLen + toothGap + toothLen * 0.5;
      for (let i = 0; i < 3; i++) {
        const cx = t0 + i * (toothLen + toothGap);
        pushKeyPart(cx, y, toothLen * 0.5, rowH * 0.5);
      }
    }
  }
  if (level) {
    level.beacons.forEach((b, i) => {
      const poleHalf = { x: MazeMeta.cellSize * 0.06, y: 0.9, z: MazeMeta.cellSize * 0.06 };
      const groundY = 1.2;
      pushInstance({
        center: { x: b.position.x, y: groundY + poleHalf.y, z: b.position.z },
        half: poleHalf,
        radius: Math.hypot(poleHalf.x, poleHalf.y, poleHalf.z),
        materialId: Material.METAL.id,
      });
      const capHalf = { x: MazeMeta.cellSize * 0.18, y: 0.05, z: MazeMeta.cellSize * 0.18 };
      const capIdx = pushInstance({
        center: { x: b.position.x, y: groundY + poleHalf.y * 2 + capHalf.y * 0.5, z: b.position.z },
        half: capHalf,
        radius: Math.hypot(capHalf.x, capHalf.y, capHalf.z),
        materialId: Material.BEACON_DARK.id,
      });
      beaconCapIndices.push(capIdx);
      beaconCapMap.push(i);
    });
  }

  const gridCell = Math.max(1.0, MazeMeta.cellSize * 1.5);
  const grid = buildCullingGrid(instances, gridCell, { minX, maxX, minZ, maxZ });
  const cullScratch = createCullingScratch(instances.length, grid);
  const instanceData = new Float32Array(instances.length * INSTANCE_FLOATS);
  const instanceScratch = new Float32Array(instanceData.length);
  instances.forEach((inst, idx) => {
    const o = idx * INSTANCE_FLOATS;
    instanceData[o + 0] = inst.center.x;
    instanceData[o + 1] = inst.center.y;
    instanceData[o + 2] = inst.center.z;
    instanceData[o + 3] = inst.half.x;
    instanceData[o + 4] = inst.half.y;
    instanceData[o + 5] = inst.half.z;
    instanceData[o + 6] = inst.materialId;
    const pivot = inst.pivot ?? inst.center;
    instanceData[o + 7] = pivot.x;
    instanceData[o + 8] = pivot.y;
    instanceData[o + 9] = pivot.z;
  });

  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  const instBuf = gl.createBuffer();
  if (!vao || !vbo || !instBuf) throw new Error('Failed to allocate buffers for geo renderer');

  const vertStride = 6 * 4;
  const instanceStride = INSTANCE_FLOATS * 4;
  const vertexCount = cubeVerts.length / 6;

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, cubeVerts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, vertStride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, vertStride, 12);

  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, instanceScratch.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, instanceStride, 0);
  gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, instanceStride, 12);
  gl.vertexAttribDivisor(3, 1);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 1, gl.FLOAT, false, instanceStride, 24);
  gl.vertexAttribDivisor(4, 1);
  gl.enableVertexAttribArray(5);
  gl.vertexAttribPointer(5, 3, gl.FLOAT, false, instanceStride, 28);
  gl.vertexAttribDivisor(5, 1);
  gl.bindVertexArray(null);

  gl.useProgram(program);
  gl.uniform1i(u.waveTexture, 1);
  gl.useProgram(null);

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 1);

  const applyUniforms = (ctx: RenderContext): void => {
    gl.uniform1f(u.timeSeconds, ctx.timeSeconds);
    gl.uniform3f(
      u.cameraPosition,
      state.controller.state.position.x,
      state.controller.state.position.y,
      state.controller.state.position.z,
    );
    gl.uniformMatrix3fv(u.cameraRotation, false, ctx.cameraRotation);
    gl.uniformMatrix4fv(u.projectionMatrix, false, ctx.projectionMatrix);
    gl.uniform1i(u.debugToggle, state.flags.debug ? 1 : 0);
    gl.uniform1f(u.ghostAmount, state.ghost);
    gl.uniform1f(u.outlineAmount, state.outline);
    gl.uniform1i(u.wireframeToggle, state.flags.wire ? 1 : 0);
    gl.uniform1f(u.gridScale, state.gridScale);
    gl.uniform1f(u.gridWidth, state.gridWidth);
    gl.uniform1i(u.heatToggle, state.flags.heat ? 1 : 0);
    gl.uniform1i(u.reflectionsToggle, state.flags.reflect ? 1 : 0);
    gl.uniform1f(u.ringFalloff, state.ui.ringFalloff);
    gl.uniform1f(u.doorGlow, state.doorGlow);
    gl.uniform4f(u.mazeBounds, MazeBounds.minX, MazeBounds.maxX, MazeBounds.minZ, MazeBounds.maxZ);
    gl.uniform1i(u.pingCount, state.pingCount);
    gl.uniform3fv(u.pingPositions, state.pingPositions);
    gl.uniform1fv(u.pingTimes, state.pingTimes);
    gl.uniform1fv(u.pingStrengths, state.pingStrengths);
    gl.uniform1f(u.afterglowMix, ctx.afterglowMix);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, ctx.waveTexture);
    gl.uniform2f(u.waveTextureSize, ctx.waveTextureWidth, ctx.waveTextureHeight);
    gl.uniform2f(u.waveOrigin, ctx.waveOriginX, ctx.waveOriginZ);
    gl.uniform1f(u.waveCellSize, ctx.waveCellSize);
  };

  const resize = (w: number, h: number): void => {
    gl.viewport(0, 0, w, h);
  };

  const render = (ctx: RenderContext): RenderStats => {
    const tSceneStart = performance.now();
    const aspect = ctx.width / Math.max(1, ctx.height);
    const tanHalfFovY = Math.tan(0.5 * (state.fovDeg * (Math.PI / 180)));
    const view = {
      position: state.controller.state.position,
      yaw: state.controller.state.yaw,
      pitch: state.controller.state.pitch,
      aspect,
      near: NEAR,
      far: FAR,
      tanHalfFovY,
    };
    const levelState = state.progress.current;
    if (keyIndices.length > 0) {
      const hideKey = !levelState || levelState.keyCollected || !levelState.data.key;
      for (const idx of keyIndices) {
        const o = idx * INSTANCE_FLOATS;
        const half = defaultHalf[idx];
        instances[idx].disabled = hideKey;
        if (hideKey) {
          instanceData[o + 3] = 0.0001;
          instanceData[o + 4] = 0.0001;
          instanceData[o + 5] = 0.0001;
          instanceData[o + 6] = 0;
          instances[idx].materialId = 0;
        } else {
          instanceData[o + 3] = half.x;
          instanceData[o + 4] = half.y;
          instanceData[o + 5] = half.z;
          instanceData[o + 6] = Material.KEY.id;
          instances[idx].materialId = Material.KEY.id;
        }
      }
    }
    for (let i = 0; i < beaconCapIndices.length; i++) {
      const idx = beaconCapIndices[i];
      const capMat = levelState?.beacons[beaconCapMap[i]]?.activated ? Material.BEACON_LIT.id : Material.BEACON_DARK.id;
      instanceData[idx * INSTANCE_FLOATS + 6] = capMat;
      instances[idx].materialId = capMat;
      instances[idx].disabled = false;
    }
    const visible = gatherVisibleInstances(grid, instances, view, cullScratch);
    const drawCount = visible.length;
    const culledCount = Math.max(0, instances.length - drawCount);
    if (drawCount > 0) {
      for (let i = 0; i < drawCount; i++) {
        const src = visible[i] * INSTANCE_FLOATS;
        const dst = i * INSTANCE_FLOATS;
        for (let j = 0; j < INSTANCE_FLOATS; j++) {
          instanceScratch[dst + j] = instanceData[src + j];
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceScratch.subarray(0, drawCount * INSTANCE_FLOATS));
    }
    gl.bindVertexArray(vao);
    gl.viewport(0, 0, ctx.width, ctx.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(program);
    gl.depthMask(true);
    applyUniforms(ctx);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, vertexCount, drawCount);

    gl.bindVertexArray(null);
    const sceneMilliseconds = performance.now() - tSceneStart;
    return { sceneMilliseconds, drawCount, culledCount };
  };

  const tests = (): void => {
    console.assert(gl.getProgramParameter(program, gl.LINK_STATUS), 'Geo linked');
    console.assert(instances.length > 0, 'Geo has instances');
    console.assert(instances.length >= Walls.length + 2, 'Geo instances include floor/ceiling/props');
    console.assert(
      Number.isFinite(minX) && Number.isFinite(maxX) && Number.isFinite(minZ) && Number.isFinite(maxZ),
      'Geo bounds computed',
    );
  };

  return { resize, render, tests };
}
