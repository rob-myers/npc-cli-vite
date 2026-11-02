import type { SfxBuilder } from "./sfx";
import { layer } from "./synth";

/** Items put down and taken up, by their `kind` — see `docs/audio.md` */
export const itemSfx = {
  /** Something put down: a book set down, a box's padded thud, a keycard's click, a phaser's clunk. On the floor, louder */
  put({ ctx, at, pitch, sample, kind, amount: floor }, out) {
    const level = 0.6 + 0.4 * floor;
    if (kind === "book") layer(ctx, sample("book"), at, out, 0.8 * level, pitch);
    else if (kind === "keycard") layer(ctx, sample("click"), at, out, 0.35 * level, 1.7 * pitch);
    else if (kind === "phaser") {
      layer(ctx, sample("armour"), at, out, 0.25 * level, 0.7 * pitch);
      layer(ctx, sample("thud"), at, out, 0.5 * level, 0.9 * pitch);
    } else layer(ctx, sample("thud"), at, out, 0.7 * level, (floor > 0 ? 0.8 : 1) * pitch);
  },
  /** Something taken up: a rustle, and its own touch */
  take({ ctx, at, pitch, sample, kind }, out) {
    layer(ctx, sample("cloth"), at, out, 0.25, pitch);
    if (kind === "book") layer(ctx, sample("book"), at, out, 0.3, 1.3 * pitch);
    else if (kind === "keycard") layer(ctx, sample("click"), at, out, 0.25, 2 * pitch);
    else if (kind === "phaser") layer(ctx, sample("click"), at + 0.05, out, 0.3, pitch);
    else layer(ctx, sample("grip"), at, out, 0.5, pitch);
  },
} satisfies Record<string, SfxBuilder>;
