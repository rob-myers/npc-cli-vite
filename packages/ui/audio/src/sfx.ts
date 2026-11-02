import { gain, panner } from "./nodes";
import { chargeVoice, phaserSfx } from "./phaser";
import type { SampleBank } from "./samples";
import { sfxLevel } from "./synth";

/** The sound effects, synthesised over a few recorded layers — see `docs/audio.md` */
export const sfxKeys = ["raise", "lower", "charged", "fire", "cool", "hit", "armour", "ghost", "wall"] as const;
export type SfxKey = (typeof sfxKeys)[number];

export const isSfxKey = (key: unknown): key is SfxKey => sfxKeys.includes(key as SfxKey);

export type SfxContext = {
  ctx: AudioContext;
  out: AudioNode;
  at: number;
  level: number;
  pan: number;
  /** How much, `0` to `1`, e.g. a shot's charge */
  amount: number;
  /** A pitch ratio near `1`, so no two alike */
  pitch: number;
  /** One of `bank`'s samples, else `null` before they load */
  sample(bank: SampleBank): null | AudioBuffer;
};

export type SfxBuilder = (c: SfxContext, out: AudioNode) => void;

/** Seconds a sound effect is kept for, its room's tail included */
export const sfxSecs = 2;

/** Plays `key` from `c.at`, into its own panner and level */
export function playSfx(key: SfxKey, c: SfxContext) {
  const out = gain(c.ctx, c.level * sfxLevel);
  out.connect(panner(c.ctx, c.pan)).connect(c.out);
  sfx[key](c, out);
  window.setTimeout(() => out.disconnect(), (c.at - c.ctx.currentTime + sfxSecs) * 1000);
}

const sfx: Record<SfxKey, SfxBuilder> = phaserSfx;

/** A sound held whilst something lasts, as a phaser charging: `level` from `0` to `1` */
export type HoldParams = { level: number; pan: number; gain: number };
export type HeldVoice = { set(params: HoldParams, at: number): void; stop(at: number): void };

export const holdKeys = ["charge"] as const;
export type HoldKey = (typeof holdKeys)[number];

export const holds: Record<HoldKey, (ctx: AudioContext, out: AudioNode) => HeldVoice> = {
  charge: chargeVoice,
};
