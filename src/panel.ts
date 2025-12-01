import { MazeSeed } from './materials';
import type { GameState } from './state';

function makeRow(
  label: string,
  id: string,
  min: number,
  max: number,
  step: number,
  val: number,
  suf: string,
  on: (v: number) => void,
): HTMLDivElement {
  const r = document.createElement('div');
  r.className = 'row';
  const L = document.createElement('label');
  L.textContent = label;
  const o = document.createElement('span');
  o.id = `${id}-out`;
  o.style.textAlign = 'right';
  const M = (v: number): void => {
    o.textContent = `${v.toFixed ? v.toFixed(3) : v}${suf || ''}`;
  };
  M(val);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = `${min}`;
  input.max = `${max}`;
  input.step = `${step}`;
  input.value = `${val}`;
  input.oninput = (e): void => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    on(v);
    M(v);
  };
  const wrap = document.createElement('div');
  wrap.appendChild(L);
  wrap.appendChild(input);
  r.appendChild(wrap);
  r.appendChild(o);
  return r;
}

function makePill(label: string): HTMLSpanElement {
  const pill = document.createElement('span');
  pill.className = 'pill';
  pill.textContent = label;
  return pill;
}

export function buildPanel(panel: HTMLElement, state: GameState, opts: { onMaster: (v: number) => void }): void {
  panel.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = 'Echo Debug';
  panel.appendChild(h);
  const info = document.createElement('div');
  info.style.marginBottom = '6px';
  info.textContent = `mazeSeed=${MazeSeed}`;
  panel.appendChild(info);
  const kv = document.createElement('div');
  kv.className = 'kv';
  for (const t of ['F4 Reflect', 'F5 Audio Echo', 'F6 Afterglow']) {
    kv.appendChild(makePill(t));
  }
  panel.appendChild(kv);
  panel.appendChild(
    makeRow('FOV (deg)', 'fov', 30, 110, 1, state.fovDeg, '', (v) => {
      state.fovDeg = v;
    }),
  );
  panel.appendChild(
    makeRow('After Mix', 'am', 0, 1, 0.01, state.ui.afterMix, '', (v) => {
      state.ui.afterMix = v;
    }),
  );
  panel.appendChild(
    makeRow('Ping wave', 'pw', 0, 1.5, 0.01, state.ui.wavePing, '', (v) => {
      state.ui.wavePing = v;
    }),
  );
  panel.appendChild(
    makeRow('Jump wave', 'jw', 0, 1.5, 0.01, state.ui.waveJump, '', (v) => {
      state.ui.waveJump = v;
    }),
  );
  panel.appendChild(
    makeRow('Step wave', 'sw', 0, 1.5, 0.01, state.ui.waveFootstep, '', (v) => {
      state.ui.waveFootstep = v;
    }),
  );
  panel.appendChild(
    makeRow('Ring falloff', 'rf', 0, 0.5, 0.01, state.ui.ringFalloff, '', (v) => {
      state.ui.ringFalloff = v;
    }),
  );
  panel.appendChild(
    makeRow('Door glow', 'dg', 0, 1, 0.01, state.doorGlow, '', (v) => {
      state.doorGlow = v;
    }),
  );
  panel.appendChild(
    makeRow('Echo Master', 'm', 0, 1, 0.01, state.ui.echoMaster, '', (v) => {
      state.ui.echoMaster = v;
      opts.onMaster(v);
    }),
  );
}
