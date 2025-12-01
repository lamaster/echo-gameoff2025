import type { GameState } from './state';
import type { Vec3 } from './types';

export const MAX_PINGS = 10;

export function addPing(state: GameState, position: Vec3, timeSec: number, strength = 1): void {
  if (state.pingCount >= MAX_PINGS) {
    state.pingPositions.copyWithin(3, 0, 3 * (MAX_PINGS - 1));
    state.pingTimes.copyWithin(1, 0, MAX_PINGS - 1);
    state.pingStrengths.copyWithin(1, 0, MAX_PINGS - 1);
  } else {
    for (let i = state.pingCount; i > 0; i--) {
      state.pingPositions[i * 3 + 0] = state.pingPositions[(i - 1) * 3 + 0];
      state.pingPositions[i * 3 + 1] = state.pingPositions[(i - 1) * 3 + 1];
      state.pingPositions[i * 3 + 2] = state.pingPositions[(i - 1) * 3 + 2];
      state.pingTimes[i] = state.pingTimes[i - 1];
      state.pingStrengths[i] = state.pingStrengths[i - 1];
    }
    state.pingCount++;
  }
  state.pingPositions[0] = position.x;
  state.pingPositions[1] = position.y;
  state.pingPositions[2] = position.z;
  state.pingTimes[0] = timeSec;
  state.pingStrengths[0] = strength;
}

export function createPingEmitter(
  state: GameState,
  audio: { playPingSound: () => void; playEchoForPing: (src: Vec3) => void },
  opts: { beforeEmit?: (nowSec: number) => boolean; afterEmit?: (nowSec: number) => void } = {},
): (strength?: number) => void {
  return function emitPing(strength = 1): void {
    const now = (performance.now() - state.start) / 1000;
    if (opts.beforeEmit && !opts.beforeEmit(now)) return;
    const p = state.controller.state.position;
    const waveMul = Math.max(0, state.ui.wavePing ?? 1);
    addPing(state, p, now, strength * waveMul);
    audio.playPingSound();
    if (state.flags.audioEcho) audio.playEchoForPing({ x: p.x, y: p.y, z: p.z });
    if (opts.afterEmit) opts.afterEmit(now);
  };
}
