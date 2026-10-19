import { time } from "three/tsl";
import { Timer } from "three-stdlib";

/** Game time, scaled by `scale` (`0` to `2`). Only the World's tick advances it, so a pause holds it */
export class GameTime {
  scale: number;
  private readonly timer = new Timer();
  private readonly onScale: (scale: number) => void;

  constructor(scale: number, onScale: (scale: number) => void) {
    this.scale = scale;
    this.onScale = onScale;
    this.timer.setTimescale(scale);
  }

  /** Seconds of game time in the last tick */
  delta() {
    return this.timer.getDelta();
  }

  /** Seconds of game time so far */
  now() {
    return this.timer.getElapsedTime();
  }

  /** The next tick counts from now, e.g. on resume */
  reset() {
    this.timer.reset();
  }

  setScale(scale: number) {
    this.scale = Math.min(2, Math.max(0, scale));
    this.timer.setTimescale(this.scale);
    this.onScale(this.scale);
  }

  /** Advances by the real time since the last tick, scaled */
  update() {
    this.timer.update();
  }
}

/** Real time, never scaled: the camera, UI marks */
export const realTime = {
  /** Seconds since page load */
  now: () => performance.now() / 1000,
  /** TSL's own clock */
  node: time,
};

export type RealTime = typeof realTime;
