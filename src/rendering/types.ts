import type { GameState } from '../state';

export type RenderStats = {
  sceneMilliseconds: number;
  drawCount?: number;
  culledCount?: number;
};

export type RenderContext = {
  timeSeconds: number;
  width: number;
  height: number;
  cameraRotation: Float32Array;
  projectionMatrix: Float32Array;
  afterglowMix: number;
  waveTexture: WebGLTexture | null;
  waveTextureWidth: number;
  waveTextureHeight: number;
  waveOriginX: number;
  waveOriginZ: number;
  waveCellSize: number;
};

export type SceneRenderer = {
  resize: (width: number, height: number) => void;
  render: (context: RenderContext) => RenderStats;
  tests?: () => void;
  dispose?: () => void;
};

export type SceneRendererFactory = (
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  state: GameState,
) => SceneRenderer;
