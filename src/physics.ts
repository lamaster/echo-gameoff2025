import { Walls } from './materials';
import type { GameState } from './state';

const PLAYER_R = 0.25;

function collideCircleAABB(x: number, z: number): { x: number; z: number } {
  for (const w of Walls) {
    const nx = Math.max(w.cx - w.hx, Math.min(x, w.cx + w.hx));
    const nz = Math.max(w.cz - w.hz, Math.min(z, w.cz + w.hz));
    const dx = x - nx;
    const dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < PLAYER_R * PLAYER_R) {
      const d = Math.sqrt(Math.max(d2, 1e-6));
      const nxn = dx / (d || 1);
      const nzn = dz / (d || 1);
      x = nx + nxn * PLAYER_R;
      z = nz + nzn * PLAYER_R;
    }
  }
  return { x, z };
}

export function moveWithCollisions(
  state: GameState,
  deltaX: number,
  deltaZ: number,
  out?: { deltaX: number; deltaZ: number },
): { deltaX: number; deltaZ: number } {
  const prevX = state.controller.state.position.x;
  const prevZ = state.controller.state.position.z;
  let x = state.controller.state.position.x + deltaX;
  let z = state.controller.state.position.z;
  ({ x, z } = collideCircleAABB(x, z));
  z += deltaZ;
  ({ x, z } = collideCircleAABB(x, z));
  state.controller.state.position.x = x;
  state.controller.state.position.z = z;
  const res = out ?? { deltaX: 0, deltaZ: 0 };
  res.deltaX = x - prevX;
  res.deltaZ = z - prevZ;
  return res;
}
