import type { SfxBuilder } from "./sfx";
import { layer } from "./synth";

/** Someone settling onto a doable or getting off it: their clothes rustling — see `docs/audio.md` */
export const postureSfx = {
  /** Sitting down: a rustle */
  sit({ ctx, at, pitch, sample }, out) {
    layer(ctx, sample("cloth"), at, out, 0.5, pitch);
  },
  /** Lying down: rustles a beat apart, as they shift and settle */
  lie({ ctx, at, pitch, sample }, out) {
    for (const [t, level] of lieRustles)
      layer(ctx, sample("cloth"), at + t, out, level, pitch * (0.9 + 0.2 * Math.random()));
  },
  /** Getting up: a rustle */
  stand({ ctx, at, pitch, sample }, out) {
    layer(ctx, sample("cloth"), at, out, 0.5, pitch);
  },
} satisfies Record<string, SfxBuilder>;

/** Lying down's rustles, as `[seconds after, level]`, each quieter as they settle */
const lieRustles: [number, number][] = [
  [0, 0.5],
  [0.3, 0.4],
  [0.65, 0.3],
];
