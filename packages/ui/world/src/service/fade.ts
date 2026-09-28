/** How far into view something is, and whither it is headed */
export type Fade = { presence: number; target: 0 | 1 };

/** Steps `x.presence` towards its target by at most `step` */
export function stepFade(x: Fade, step: number) {
  x.presence += Math.max(-step, Math.min(step, x.target - x.presence));
}

/** Smoothstep on `[0, 1]`, so a fade neither snaps out nor lingers */
export const eased = (x: number) => x * x * (3 - 2 * x);
