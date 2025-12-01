import { describe, expect, it } from 'bun:test';
import { createPingEmitter, MAX_PINGS } from '../pings';
import { createState } from '../state';

describe('createPingEmitter', () => {
  it('adds a ping and records sound/echo calls', () => {
    const state = createState();
    const calls = { sound: 0, echo: 0 };
    const emit = createPingEmitter(state, {
      playPingSound: () => {
        calls.sound += 1;
      },
      playEchoForPing: () => {
        calls.echo += 1;
      },
    });

    emit();

    expect(state.pingCount).toBe(1);
    expect(state.pingPositions[0]).toBeCloseTo(state.controller.state.position.x);
    expect(state.pingTimes[0]).toBeGreaterThan(0);
    expect(calls.sound).toBe(1);
    expect(calls.echo).toBe(1);
  });

  it('shifts history when exceeding max pings', () => {
    const state = createState();
    state.pingCount = MAX_PINGS;
    for (let i = 0; i < MAX_PINGS; i++) {
      state.pingTimes[i] = i + 10;
      state.pingPositions[i * 3 + 0] = i;
      state.pingPositions[i * 3 + 1] = i;
      state.pingPositions[i * 3 + 2] = i;
    }

    const emit = createPingEmitter(state, {
      playPingSound: () => {},
      playEchoForPing: () => {},
    });

    const beforeTimes = Array.from(state.pingTimes);
    emit();
    const afterTimes = Array.from(state.pingTimes);

    expect(state.pingCount).toBe(MAX_PINGS);
    expect(afterTimes[1]).toBeCloseTo(beforeTimes[0]); // newest-old becomes index1
    expect(afterTimes[MAX_PINGS - 1]).toBeCloseTo(beforeTimes[MAX_PINGS - 2]); // oldest dropped
    expect(afterTimes.includes(beforeTimes[MAX_PINGS - 1])).toBe(false); // last entry removed
    expect(afterTimes[0]).not.toBe(beforeTimes[0]); // new ping inserted at front
  });
});
