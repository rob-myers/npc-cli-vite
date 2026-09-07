import { frontierHalfDeg, frontierReadMinMs } from "../const";
import { lightAngles, type PlayerLight } from "./player-light";

/**
 * How far the player can see ahead, in metres — read off the light's own sweep, which has already
 * cast every direction on the GPU. The furthest of a fan `frontierHalfDeg` either side of the
 * facing, since one ray flickers as they turn past a jamb. Read only after a fresh sweep, and at
 * most once per `frontierReadMinMs`; the read is asynchronous, so the answer is a frame or so
 * behind, which the eased camera never notices — provided a frame follows, hence `onRead`, since
 * under a demand frameloop the frames may have stopped. See `WorldView`'s `easeFrontier`
 */
export function createPlayerFrontier(getLight: () => PlayerLight, onRead: () => void): PlayerFrontier {
  const halfCount = Math.round((lightAngles * frontierHalfDeg) / 360);
  const table = new Float32Array(lightAngles);
  /** The frontier vector, eased: the reading leaps, and a turn swings it. `null` until first read */
  let eased: null | { x: number; z: number } = null;
  let pending = false;
  let readSweep = 0;
  let lastReadMs = 0;

  const frontier: PlayerFrontier = {
    reach: null,
    ahead(out) {
      if (eased === null) return false;
      out.x = eased.x;
      out.z = eased.z;
      return true;
    },
    update(rotationY, deltaSecs, rate) {
      const lookAngle = -rotationY - Math.PI / 2; // three's rotation-Y to an angle in world XZ
      const sweeps = getLight().getSweeps();
      if (sweeps === 0) {
        frontier.reach = null;
        eased = null;
        return;
      }

      const nowMs = performance.now();
      if (pending === false && sweeps !== readSweep && nowMs - lastReadMs >= frontierReadMinMs) {
        const read = getLight().readTable(table);
        if (read !== null) {
          pending = true;
          readSweep = sweeps;
          lastReadMs = nowMs;
          // the facing as an index into the table — see `player-light`'s `litFrom`
          const centre = Math.round((((lookAngle / (2 * Math.PI)) % 1) + 1) * lightAngles);
          read.then(
            () => {
              let furthest = 0;
              for (let i = -halfCount; i <= halfCount; i++) {
                furthest = Math.max(furthest, table[(centre + i + lightAngles) % lightAngles]);
              }
              frontier.reach = furthest;
              pending = false;
              onRead();
            },
            (error) => {
              pending = false;
              console.warn("player-frontier: reading the sweep back failed", error);
            },
          );
        }
      }

      if (frontier.reach === null) return;
      const x = Math.cos(lookAngle) * frontier.reach;
      const z = Math.sin(lookAngle) * frontier.reach;
      if (eased === null) {
        eased = { x, z };
      } else {
        // exponential approach, so it is frame-rate independent and has no end to overshoot
        const alpha = 1 - Math.exp(-rate * deltaSecs);
        eased.x += (x - eased.x) * alpha;
        eased.z += (z - eased.z) * alpha;
      }
    },
  };
  return frontier;
}

export type PlayerFrontier = {
  /** Metres ahead the player can see, up to `lightRadius` — `null` whilst the light is off or unread */
  reach: null | number;
  /** The eased vector from the player to their frontier, into `out` — `false`, and untouched, whilst unread */
  ahead(out: { x: number; z: number }): boolean;
  /**
   * Reads the sweep when there is a fresh one, and eases the vector at `rate` per second. Call
   * once per frame, after the sweep
   */
  update(rotationY: number, deltaSecs: number, rate: number): void;
};
