import { applyLookDelta, setControllerRotationEnabled } from './controller';
import type { GameState } from './state';

export function bindInput(
  canvas: HTMLCanvasElement,
  state: GameState,
  actions: {
    emitPing: () => void;
    queueJump: () => void;
    allowDebugHotkeys?: boolean;
    onPointerLockChange?: (locked: boolean) => void;
  },
): { requestPointerLock: () => void; exitPointerLock: () => void } {
  const allowDebugHotkeys = actions.allowDebugHotkeys ?? true;
  const isPointerLocked = (): boolean => document.pointerLockElement === canvas;
  const requestPointerLock = (): void => {
    if (canvas.requestPointerLock) canvas.requestPointerLock();
  };
  const exitPointerLock = (): void => {
    if (document.exitPointerLock) document.exitPointerLock();
  };
  const applyCursor = (locked: boolean): void => {
    canvas.classList.toggle('locked-cursor', locked);
    canvas.style.cursor = locked ? 'none' : 'crosshair';
  };

  const handleGameplayKey = (code: string, e: KeyboardEvent): boolean => {
    if (code === 'space') {
      actions.queueJump();
      e.preventDefault();
      return true;
    }
    if (code === 'keyx') {
      actions.emitPing();
      e.preventDefault();
      return true;
    }
    if (code === 'keyf') {
      canvas.requestFullscreen?.();
      requestPointerLock();
      e.preventDefault();
      return true;
    }
    return false;
  };

  const handleDebugHotkey = (code: string, e: KeyboardEvent): boolean => {
    if (!allowDebugHotkeys) return false;
    switch (code) {
      case 'f1':
        state.flags.debug = !state.flags.debug;
        break;
      case 'f2':
        state.flags.wire = !state.flags.wire;
        break;
      case 'f3':
        state.flags.heat = !state.flags.heat;
        break;
      case 'f4':
        state.flags.reflect = !state.flags.reflect;
        break;
      case 'f5':
        state.flags.audioEcho = !state.flags.audioEcho;
        break;
      case 'f6':
        state.flags.afterglow = !state.flags.afterglow;
        break;
      default:
        return false;
    }
    e.preventDefault();
    return true;
  };

  canvas.addEventListener('keydown', (e) => {
    const code = e.code.toLowerCase();
    state.input.keys[code] = true;
    if (handleGameplayKey(code, e)) return;
    if (handleDebugHotkey(code, e)) return;
    e.preventDefault();
  });

  canvas.addEventListener('keyup', (e) => {
    state.input.keys[e.code.toLowerCase()] = false;
    e.preventDefault();
  });

  canvas.addEventListener('blur', () => {
    state.input.keys = Object.create(null) as Record<string, boolean>;
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      requestPointerLock();
      if (!isPointerLocked()) {
        state.input.rotating = true;
        setControllerRotationEnabled(state.controller, true);
        state.input.lastX = e.clientX;
        state.input.lastY = e.clientY;
      }
      canvas.focus({ preventScroll: true });
      e.preventDefault();
    }
  });

  addEventListener('mouseup', (e) => {
    if (e.button === 0 && !isPointerLocked()) {
      state.input.rotating = false;
      setControllerRotationEnabled(state.controller, false);
    }
  });

  addEventListener('mousemove', (e) => {
    if (isPointerLocked()) {
      state.input.rotating = true;
      setControllerRotationEnabled(state.controller, true);
      applyLookDelta(state.controller, e.movementX, e.movementY);
      return;
    }
    if (!state.input.rotating) return;
    const dx = e.clientX - state.input.lastX;
    const dy = e.clientY - state.input.lastY;
    state.input.lastX = e.clientX;
    state.input.lastY = e.clientY;
    applyLookDelta(state.controller, dx, dy);
  });

  addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      state.input.rotating = false;
      setControllerRotationEnabled(state.controller, false);
      canvas.blur();
    }
  });

  canvas.addEventListener('focus', () => {
    requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    const locked = isPointerLocked();
    state.input.rotating = locked;
    state.input.pointerLocked = locked;
    if (!locked) {
      state.input.keys = Object.create(null) as Record<string, boolean>;
    }
    setControllerRotationEnabled(state.controller, locked);
    applyCursor(locked);
    if (actions.onPointerLockChange) actions.onPointerLockChange(locked);
  });
  applyCursor(isPointerLocked());

  return { requestPointerLock, exitPointerLock };
}
