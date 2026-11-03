import { chantVoice, choirVoice, monkVoice } from "./choir";
import { type DoorVoice, doorSfx, doorVoice } from "./doors";
import { itemSfx } from "./items";
import { gain, panner } from "./nodes";
import { chargeVoice, phaserSfx } from "./phaser";
import { postureSfx } from "./posture";
import type { SampleBank } from "./samples";
import { sfxLevel } from "./synth";

/** The sound effects, synthesised over a few recorded layers — see `docs/audio.md` */
export const sfxKeys = [
  ...(["raise", "lower", "charged", "fire", "cool", "hit", "armour", "ghost", "wall"] as const),
  ...(["opened", "closed", "lock", "unlock", "hold", "unhold", "denied"] as const),
  ...(["sit", "lie", "stand", "put", "take"] as const),
];
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
  /** An item's kind, as `inventoryConfig.kinds` */
  kind: string;
  /** A door's voice */
  voice: DoorVoice;
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

const sfx: Record<SfxKey, SfxBuilder> = { ...phaserSfx, ...doorSfx, ...postureSfx, ...itemSfx };

/** The bus an effect plays through: the World's own sounds through `world`, the phaser's through `fx` */
export const sfxBus = (key: SfxKey) => (key in phaserSfx ? "fx" : "world");

/** A sound held whilst something lasts, as a phaser charging or a door moving: `level` from `0` to `1` */
/** `pick` is which of a bank's samples, else one at random */
export type HoldParams = { level: number; pan: number; gain: number; voice?: DoorVoice; pick?: number };
export type HeldVoice = { set(params: HoldParams, at: number): void; stop(at: number): void };

export const holdKeys = ["charge", "door", "choir", "monk", "chant"] as const;
export type HoldKey = (typeof holdKeys)[number];

/** Each held voice's builder, given the params it is first held with */
/** Each held voice's builder, given the params it is first held with, and a sample of a bank */
export const holds: Record<
  HoldKey,
  (
    ctx: AudioContext,
    out: AudioNode,
    params: HoldParams,
    sample: (bank: SampleBank, pick?: number) => null | AudioBuffer,
  ) => HeldVoice
> = {
  charge: chargeVoice,
  door: doorVoice,
  choir: choirVoice,
  monk: monkVoice,
  chant: chantVoice,
};

/** The bus a held voice plays through */
export const holdBus = (key: HoldKey) => (key === "charge" ? "fx" : "world");
