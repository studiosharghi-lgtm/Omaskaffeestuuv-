import type { PerspectiveCamera, Scene } from 'three';
import type { HandoffView } from './FootageLayer';
import type { Quality } from './quality';

export interface StageSize {
  /** CSS pixels */
  width: number;
  height: number;
  aspect: number;
}

/** What the 3D world wants rendered for the current scroll position. */
export interface WorldFrame {
  /** 0 = footage only, 1 = 3D only. */
  sceneMix: number;
  /** Opacity of the steam layer (also used over footage). */
  steam: number;
  /** Mip bias used to soften the steam layer according to focus. */
  steamSoftness: number;
  /** Focus distance in metres. */
  focus: number;
  /** Blur radius, as a fraction of stage height, for one dioptre of defocus. */
  aperture: number;
  exposure: number;
  /** Something moves on its own (steam, idle drift): keep rendering. */
  continuous: boolean;
}

export interface World {
  readonly scene: Scene;
  readonly steamScene: Scene;
  readonly camera: PerspectiveCamera;
  frame(t: number, now: number, stage: StageSize, handoff: HandoffView): WorldFrame;
  setQuality(q: Quality): void;
  /** Horizontal drag in the final scene, in radians. */
  setOrbitInput(yaw: number, pitch: number): void;
  dispose(): void;
}
