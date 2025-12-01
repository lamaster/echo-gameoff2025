import { Material, MazeBounds, occlusionAtten } from '../materials';
import { gatherReflectionImages, type ReflectionImage } from '../reflections';
import type { GameState } from '../state';
import { VISUAL_WAVE_C } from '../state';
import type { Vec3 } from '../types';

type AudioMaster = { ac: AudioContext; master: GainNode };

export function createAudio(state: GameState): {
  ensureAC: () => AudioContext | null;
  playPingSound: () => void;
  playEchoForPing: (src: Vec3) => void;
  playFootstepSound: (gain?: number) => void;
  playJumpSound: () => void;
  playLandSound: () => void;
  playExitKnockSound: (intensity?: number, pan?: number) => void;
  playDoorBlockedSound: () => void;
  playKeyPickupSound: () => void;
  playDoorOpenSound: () => void;
  playBeaconChime: (pan?: number, bright?: number, gainMul?: number) => void;
  playFailSound: () => void;
  playCooldownTick: () => void;
  setMasterGain: (v: number) => void;
} {
  let ctx: AudioMaster | null = null;
  const reflectionScratch: ReflectionImage[] = Array.from({ length: 4 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    reflect: Material.OUTER.reflect,
    distance: 0,
  }));

  function ensureAC(): AudioContext | null {
    const AC =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      const ac = new AC();
      const master = ac.createGain();
      master.gain.value = state.ui.echoMaster;
      master.connect(ac.destination);
      ctx = { ac, master };
    }
    if (ctx.ac.state === 'suspended') {
      try {
        void ctx.ac.resume();
      } catch (e) {
        console.warn('Audio resume failed', e);
      }
    }
    return ctx.ac;
  }

  function noiseBurst(ac: AudioContext, dur = 0.03, hpHz = 1800): void {
    if (!ctx) return;
    const len = (ac.sampleRate * dur) | 0;
    const b = ac.createBuffer(1, len, ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp((-i / len) * 6);
    const s = ac.createBufferSource();
    s.buffer = b;
    const g = ac.createGain();
    g.gain.value = state.ui.pingClick;
    const f = ac.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hpHz;
    s.connect(f);
    f.connect(g);
    g.connect(ctx.master);
    const t = ctx.ac.currentTime + 0.001;
    s.start(t);
    s.stop(t + dur);
  }

  function playPingSound(): void {
    const ac = ensureAC();
    if (!ac || !ctx) return;
    const o1 = ac.createOscillator();
    const g1 = ac.createGain();
    const o2 = ac.createOscillator();
    const g2 = ac.createGain();
    o1.type = 'sine';
    o2.type = 'square';
    o1.frequency.value = 1600;
    o2.frequency.value = 900;
    g1.gain.value = 0;
    g2.gain.value = 0;
    o1.connect(g1);
    g1.connect(ctx.master);
    o2.connect(g2);
    g2.connect(ctx.master);
    const t = ac.currentTime;
    g1.gain.setValueAtTime(0, t);
    g1.gain.linearRampToValueAtTime(1, t + 0.01);
    g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(0.6, t + 0.01);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o1.start(t);
    o1.stop(t + 0.24);
    o2.start(t);
    o2.stop(t + 0.2);
    if (state.ui.pingClick > 0.001) noiseBurst(ac, 0.03, 1800);
  }

  function scheduleEcho(delaySec: number, gain: number, pan: number, lpHz: number): void {
    const ac = ensureAC();
    if (!ac || !ctx) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = Math.max(300, lpHz || 4000);
    let p: StereoPannerNode | null = null;
    if (ac.createStereoPanner) {
      p = ac.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan || 0));
    }
    o.type = 'sine';
    o.frequency.value = Math.max(200, Math.min(6000, state.ui.echoFreq));
    o.connect(f);
    f.connect(g);
    if (p) {
      g.connect(p);
      p.connect(ctx.master);
    } else {
      g.connect(ctx.master);
    }
    const t0 = ac.currentTime + Math.max(0.001, delaySec || 0);
    const t1 = t0 + 0.22;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, gain || 0.25)), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t1);
    o.start(t0);
    o.stop(t1);
  }

  function computeEchoTaps(listener: Vec3, yaw: number, src: Vec3) {
    const unitMeters = state.ui.unitMeters;
    const c = 343.0;
    const imgCount = gatherReflectionImages(
      src,
      MazeBounds,
      Material.OUTER.reflect,
      reflectionScratch,
      reflectionScratch.length,
    );
    const rX = Math.cos(yaw);
    const rZ = Math.sin(yaw);
    const taps: Array<{ delay: number; pan: number; gain: number; lpHz: number; occHits: number }> = [];
    for (let i = 0; i < imgCount; i++) {
      const im = reflectionScratch[i];
      const dx = im.x - listener.x;
      const dz = im.z - listener.z;
      const du = Math.hypot(dx, dz) || 1e-6;
      const distM = du * unitMeters;
      const delayPhys = distM / c;
      const delayAV = du / VISUAL_WAVE_C;
      const dirX = dx / du;
      const dirZ = dz / du;
      const pan = Math.max(-1, Math.min(1, dirX * rX + dirZ * rZ));
      const occ = occlusionAtten(listener, im);
      const baseGain = 0.35 * state.ui.echoGainMul * Math.exp(-distM * state.ui.echoDistK);
      const gain = baseGain * im.reflect * occ.gainMul;
      const lpHz = (8000 * Math.exp(-distM * state.ui.echoLPK) + state.ui.echoLPBase) * occ.lpMul;
      taps.push({ delay: state.ui.avSync ? delayAV : delayPhys, pan, gain, lpHz, occHits: occ.hits });
    }
    return taps;
  }

  function playEchoForPing(src: Vec3): void {
    const listener = state.controller.state.position;
    const yaw = state.controller.state.yaw;
    const taps = computeEchoTaps(listener, yaw, src);
    const bias = (state.ui.delayBiasMs || 0) / 1000;
    for (const t of taps) scheduleEcho(t.delay + bias, t.gain, t.pan, t.lpHz);
  }

  function playExitKnockSound(intensity = 0.6, pan = 0): void {
    const ac = ensureAC();
    if (!ac || !ctx) return;
    const t0 = ac.currentTime + 0.001;
    const panner = ac.createStereoPanner ? ac.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      panner.connect(ctx.master);
    }
    const dest: AudioNode = panner ?? ctx.master;
    const hit = (offset: number, gainMul: number): void => {
      const osc = ac.createOscillator();
      const filt = ac.createBiquadFilter();
      const g = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 180 + 80 * intensity;
      filt.type = 'lowpass';
      filt.frequency.value = 900 + 1200 * intensity;
      osc.connect(filt);
      filt.connect(g);
      g.connect(dest);
      const start = t0 + offset;
      const peak = Math.max(0.05, 0.22 * intensity * gainMul);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(peak, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      osc.start(start);
      osc.stop(start + 0.34);
      const len = (ac.sampleRate * 0.04) | 0;
      const b = ac.createBuffer(1, len, ac.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp((-i / len) * 6);
      const noise = ac.createBufferSource();
      noise.buffer = b;
      const ng = ac.createGain();
      ng.gain.value = peak * 0.6;
      noise.connect(ng);
      ng.connect(dest);
      noise.start(start);
      noise.stop(start + 0.07);
    };
    hit(0.0, 1.0);
    hit(0.14, 0.7);
  }

  function playDoorBlockedSound(): void {
    const ac = ensureAC();
    if (!ac || !ctx) return;
    const t0 = ac.currentTime + 0.001;
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t0);
    osc.frequency.exponentialRampToValueAtTime(80, t0 + 0.38);
    const shaper = ac.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < curve.length; i++) curve[i] = 1 - 2 * (i / (curve.length - 1));
    shaper.curve = curve;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 240;
    bp.Q.value = 5;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.5, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
    osc.connect(bp);
    bp.connect(shaper);
    shaper.connect(g);
    g.connect(ctx.master);
    osc.start(t0);
    osc.stop(t0 + 0.55);

    const len = (ac.sampleRate * 0.18) | 0;
    const b = ac.createBuffer(1, len, ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * (1 - t) * 0.9;
    }
    const noise = ac.createBufferSource();
    noise.buffer = b;
    const ng = ac.createGain();
    ng.gain.value = 0.22;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 220;
    noise.connect(hp);
    hp.connect(ng);
    ng.connect(ctx.master);
    const tn = t0 + 0.05;
    noise.start(tn);
    noise.stop(tn + 0.2);
  }

  function playKeyPickupSound(): void {
    const ac = ensureAC();
    if (!ac || !ctx) return;
    const t0 = ac.currentTime + 0.001;
    const osc1 = ac.createOscillator();
    const osc2 = ac.createOscillator();
    const g = ac.createGain();
    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(880, t0);
    osc1.frequency.exponentialRampToValueAtTime(1320, t0 + 0.25);
    osc2.frequency.setValueAtTime(660, t0);
    osc2.frequency.exponentialRampToValueAtTime(990, t0 + 0.22);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.85, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    osc1.connect(g);
    osc2.connect(g);
    g.connect(ctx.master);
    osc1.start(t0);
    osc2.start(t0);
    osc1.stop(t0 + 0.7);
    osc2.stop(t0 + 0.7);
  }

  function playDoorOpenSound(): void {
    const ac = ensureAC();
    if (!ac || !ctx) return;
    const t0 = ac.currentTime + 0.001;
    const bus = ac.createGain();
    bus.gain.value = 0.85;
    bus.connect(ctx.master);

    const chord = [520, 660, 880];
    chord.forEach((f, idx) => {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      const start = t0 + idx * 0.04;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f * 0.94, start);
      osc.frequency.linearRampToValueAtTime(f * 1.05, start + 0.4);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.32, start + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.0);
      osc.connect(g);
      g.connect(bus);
      osc.start(start);
      osc.stop(t0 + 1.05);
    });

    const sub = ac.createOscillator();
    const subG = ac.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(160, t0);
    sub.frequency.exponentialRampToValueAtTime(240, t0 + 0.5);
    subG.gain.setValueAtTime(0, t0);
    subG.gain.linearRampToValueAtTime(0.28, t0 + 0.04);
    subG.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    sub.connect(subG);
    subG.connect(bus);
    sub.start(t0);
    sub.stop(t0 + 0.95);

    const sparkleLen = (ac.sampleRate * 0.25) | 0;
    const sparkleBuf = ac.createBuffer(1, sparkleLen, ac.sampleRate);
    const sparkle = ac.createBufferSource();
    const data = sparkleBuf.getChannelData(0);
    for (let i = 0; i < sparkleLen; i++) {
      const t = i / sparkleLen;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 6);
    }
    sparkle.buffer = sparkleBuf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4200;
    bp.Q.value = 6;
    const sg = ac.createGain();
    sg.gain.value = 0.18;
    sparkle.connect(bp);
    bp.connect(sg);
    sg.connect(bus);
    sparkle.start(t0 + 0.05);
    sparkle.stop(t0 + 0.5);
  }

  function playBeaconChime(pan = 0, bright = 1, gainMul = 1): void {
    const ac = ensureAC();
    if (!ac || !ctx) return;
    const t0 = ac.currentTime + 0.001;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    const panner = ac.createStereoPanner ? ac.createStereoPanner() : null;
    osc.type = 'triangle';
    osc.frequency.value = 780 + 260 * bright;
    const gain = Math.max(0, Math.min(1, gainMul));
    const peak = Math.max(0.04, 0.5 * gain);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
    osc.connect(g);
    if (panner) {
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(panner);
      panner.connect(ctx.master);
    } else {
      g.connect(ctx.master);
    }
    osc.start(t0);
    osc.stop(t0 + 0.38);
  }

  function playFailSound(): void {
    const ac = ensureAC();
    if (!ac || !ctx) return;
    const t0 = ac.currentTime + 0.001;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(420, t0);
    osc.frequency.linearRampToValueAtTime(240, t0 + 0.28);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.5, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.36);
    osc.connect(g);
    g.connect(ctx.master);
    osc.start(t0);
    osc.stop(t0 + 0.4);
  }

  function playCooldownTick(): void {
    const ac = ensureAC();
    if (!ac || !ctx) return;
    const t0 = ac.currentTime + 0.001;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 520;
    osc.type = 'sine';
    osc.frequency.value = 320;
    osc.connect(f);
    f.connect(g);
    g.connect(ctx.master);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.006, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    osc.start(t0);
    osc.stop(t0 + 0.34);
  }

  function setMasterGain(v: number): void {
    state.ui.echoMaster = v;
    if (!ctx && v > 0) ensureAC();
    if (ctx) ctx.master.gain.value = v;
  }

  function playFootstepSound(gain = 0.25): void {
    const ac = ensureAC();
    if (!ac || !ctx) return;
    const len = (ac.sampleRate * 0.08) | 0;
    const b = ac.createBuffer(1, len, ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * (1 - t) * 0.5;
    }
    const src = ac.createBufferSource();
    src.buffer = b;
    const g = ac.createGain();
    g.gain.value = gain * 0.6;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 800;
    src.connect(f);
    f.connect(g);
    g.connect(ctx.master);
    const t0 = ac.currentTime + 0.001;
    src.start(t0);
    src.stop(t0 + 0.12);
  }

  function playJumpSound(): void {
    const ac = ensureAC();
    if (!ac || !ctx) return;
    noiseBurst(ac, 0.08, 300);
  }

  function playLandSound(): void {
    const ac = ensureAC();
    if (!ac || !ctx) return;
    noiseBurst(ac, 0.06, 200);
  }

  return {
    ensureAC,
    playPingSound,
    playEchoForPing,
    playFootstepSound,
    playJumpSound,
    playLandSound,
    playExitKnockSound,
    playDoorBlockedSound,
    playKeyPickupSound,
    playDoorOpenSound,
    playBeaconChime,
    playFailSound,
    playCooldownTick,
    setMasterGain,
  };
}
