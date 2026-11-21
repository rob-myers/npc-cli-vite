import { filter } from "./nodes";
import type { SfxBuilder } from "./sfx";
import { layer, noise } from "./synth";

/** A body falling dead, and a foot coming down on one — see `docs/audio.md` */
export const bodySfx = {
  /**
   * Falling dead onto the deck: their body slapping it, its plating under them, then their limbs, one of `falls`.
   * Then their head knocking it, an arm flopping down, and sometimes their gear, each a little early or late
   */
  fall({ ctx, at, pitch, sample }, out) {
    const late = (from: number, to: number) => at + from + Math.random() * (to - from);
    for (const [bank, secs, level, rate] of falls[Math.floor(Math.random() * falls.length)])
      layer(ctx, sample(bank), at + secs, out, level, rate * pitch);
    layer(ctx, sample("armour"), late(0.03, 0.07), out, 0.12, 0.75 * pitch);
    layer(ctx, sample("book"), late(0.25, 0.35), out, 0.2, 0.7 * pitch);
    if (Math.random() < 0.5) layer(ctx, sample("click"), late(0.1, 0.2), out, 0.15, 0.6 * pitch);
  },
  /** A foot coming down on a corpse: the body giving under it, their clothes, and its weight muffled */
  tread({ ctx, at, pitch, sample }, out) {
    noise(ctx, at, 0.14, out, 0.12, "lowpass", 320 * pitch, 0.02);
    layer(ctx, sample("cloth"), at, out, 0.18, 0.9 * pitch);
    const muffled = filter(ctx, "lowpass", 450);
    muffled.connect(out);
    layer(ctx, sample("thud"), at, muffled, 0.07, 0.6 * pitch);
  },
} satisfies Record<string, SfxBuilder>;

/**
 * Ways a body lands, each a list of `[bank, secs after, level, rate]`: a slap (`book`, low), the plating (`armour`,
 * lower still), and their limbs. The body, then its limbs; heavier with two limbs; limbs first; quicker with a late limb
 */
const falls: ["book" | "armour", number, number, number][][] = [
  [
    ["book", 0, 0.9, 0.55],
    ["armour", 0, 0.25, 0.45],
    ["book", 0.08, 0.35, 0.8],
  ],
  [
    ["book", 0, 1, 0.5],
    ["armour", 0, 0.3, 0.4],
    ["book", 0.07, 0.3, 0.85],
    ["book", 0.15, 0.25, 0.9],
  ],
  [
    ["book", 0, 0.4, 0.85],
    ["book", 0.09, 0.9, 0.55],
    ["armour", 0.09, 0.25, 0.45],
  ],
  [
    ["book", 0, 0.9, 0.6],
    ["armour", 0, 0.2, 0.5],
    ["book", 0.12, 0.35, 0.75],
  ],
];
