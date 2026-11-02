import type { SfxBuilder } from "./sfx";
import { layer } from "./synth";

/** Someone settling onto a doable or getting off it: their clothes rustling — see `docs/audio.md` */
export const postureSfx = {
  /** Sitting down: a rustle */
  sit({ ctx, at, pitch, sample }, out) {
    layer(ctx, sample("cloth"), at, out, 0.5, pitch);
  },
  /** Lying down: a rustle, slowed so it lasts longer */
  lie({ ctx, at, pitch, sample }, out) {
    layer(ctx, sample("cloth"), at, out, 0.5, lieRate * pitch);
  },
  /** Getting up: a rustle */
  stand({ ctx, at, pitch, sample }, out) {
    layer(ctx, sample("cloth"), at, out, 0.5, pitch);
  },
} satisfies Record<string, SfxBuilder>;

/** Lying down's rustle's speed: slower is longer */
const lieRate = 0.6;
