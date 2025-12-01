import { MazeBounds, MazeExitDoor, MazeMeta, MazeRows } from './materials';
import type { GameState } from './state';
import { VISUAL_WAVE_C } from './state';

function worldToMap(x: number, z: number, scaleX: number, scaleZ: number): { x: number; y: number } {
  return { x: (x - MazeBounds.minX) * scaleX, y: (z - MazeBounds.minZ) * scaleZ };
}

function drawEchoWaves(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  nowSec: number,
  scaleX: number,
  scaleZ: number,
  radiusScale: number,
  minCell: number,
): void {
  const maxAge = 4.2;
  const baseWidth = Math.max(1.2, minCell * 0.55);
  for (let i = 0; i < state.pingCount; i++) {
    const age = nowSec - state.pingTimes[i];
    if (age < 0 || age > maxAge) continue;
    const radius = age * VISUAL_WAVE_C;
    const fade = Math.max(0, 1 - age / maxAge) * Math.exp(-state.ui.ringFalloff * radius);
    const strength = state.pingStrengths[i] || 1;
    const alpha = fade * strength;
    if (alpha < 0.04) continue;
    const rPx = radius * radiusScale;
    if (rPx < 1.5) continue;
    const center = worldToMap(state.pingPositions[i * 3], state.pingPositions[i * 3 + 2], scaleX, scaleZ);
    ctx.strokeStyle = `rgba(126, 226, 255, ${0.55 * alpha})`;
    ctx.lineWidth = baseWidth * (0.6 + 0.4 * Math.min(1, strength));
    ctx.beginPath();
    ctx.arc(center.x, center.y, rPx, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export function drawMiniMap(canvas: HTMLCanvasElement, state: GameState): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const level = state.progress.current;
  const { cols, rows } = MazeMeta;
  const w = canvas.width;
  const h = canvas.height;
  const cw = w / cols;
  const ch = h / rows;
  const scaleX = w / (MazeBounds.maxX - MazeBounds.minX);
  const scaleZ = h / (MazeBounds.maxZ - MazeBounds.minZ);
  const radiusScale = 0.5 * (scaleX + scaleZ);
  const minCell = Math.min(cw, ch);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0a0f1a';
  ctx.fillRect(0, 0, w, h);
  let startPos: { x: number; y: number } | null = null;
  for (let r = 0; r < rows; r++) {
    const line = MazeRows[r];
    for (let c = 0; c < cols; c++) {
      const cell = line[c];
      if (cell === '1') ctx.fillStyle = '#30435a';
      else if (cell === '2') ctx.fillStyle = '#3fbf7f';
      else if (cell === '3') ctx.fillStyle = '#f0c75e';
      else continue;
      if (cell === '2') startPos = { x: c * cw + cw * 0.5, y: r * ch + ch * 0.5 };
      ctx.fillRect(c * cw, r * ch, cw, ch);
    }
  }
  const nowSec = (performance.now() - state.start) / 1000;
  drawEchoWaves(ctx, state, nowSec, scaleX, scaleZ, radiusScale, minCell);
  ctx.fillStyle = '#0a0f1a';
  if (startPos) {
    const fontPx = Math.max(9, Math.min(12, minCell * 0.9));
    ctx.font = `bold ${fontPx}px ui-monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('S', startPos.x, startPos.y);
  }
  // Exit door icon/label (oriented)
  const exitDoorPos = worldToMap(MazeExitDoor.position.x, MazeExitDoor.position.z, scaleX, scaleZ);
  const doorW =
    Math.abs(MazeExitDoor.normal.z) > 0.5
      ? Math.max(6, MazeExitDoor.width * scaleX)
      : Math.max(6, MazeExitDoor.depth * scaleX);
  const doorH =
    Math.abs(MazeExitDoor.normal.x) > 0.5
      ? Math.max(9, MazeExitDoor.width * scaleZ)
      : Math.max(9, MazeExitDoor.depth * scaleZ);
  ctx.save();
  ctx.translate(exitDoorPos.x, exitDoorPos.y);
  ctx.fillStyle = '#f6d266';
  ctx.strokeStyle = '#9c6f1c';
  ctx.lineWidth = Math.max(1, minCell * 0.2);
  ctx.beginPath();
  ctx.rect(-doorW * 0.5, -doorH * 0.5, doorW, doorH);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#0a0f1a';
  const exitFontPx = Math.max(9, Math.min(12, minCell * 0.9));
  ctx.font = `bold ${exitFontPx}px ui-monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('E', 0, 0);
  ctx.restore();
  // key marker
  if (level?.data.key && !level.keyCollected) {
    const k = worldToMap(level.data.key.position.x, level.data.key.position.z, scaleX, scaleZ);
    const r = Math.max(4, minCell * 0.4);
    ctx.fillStyle = '#ffe07a';
    ctx.beginPath();
    ctx.arc(k.x, k.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0a0f1a';
    ctx.font = `bold ${Math.max(8, minCell * 0.8)}px ui-monospace`;
    ctx.fillText('K', k.x, k.y);
  }
  // beacons
  if (level) {
    for (const b of level.beacons) {
      const p = worldToMap(b.position.x, b.position.z, scaleX, scaleZ);
      const r = Math.max(3, minCell * 0.3);
      ctx.fillStyle = b.activated ? '#66e0ff' : '#34546e';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // player marker
  const p = worldToMap(state.controller.state.position.x, state.controller.state.position.z, scaleX, scaleZ);
  ctx.fillStyle = '#9ef';
  const r = Math.max(2, minCell * 0.25);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  // facing direction
  const dirLen = Math.max(8, minCell * 1.2);
  const dx = Math.sin(state.controller.state.yaw) * dirLen;
  const dz = -Math.cos(state.controller.state.yaw) * dirLen;
  ctx.strokeStyle = '#3fbf7f';
  ctx.lineWidth = Math.max(1.5, minCell * 0.18);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + dx, p.y + dz);
  ctx.stroke();
}
