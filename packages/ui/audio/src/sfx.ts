import { filter, gain, getPinkNoise, osc, panner } from "./nodes";

/** Weapon sounds, all synthesised — see `docs/audio.md` */
export const sfxKeys = ["phaser", "hit", "armour", "ghost", "wall"] as const;
export type SfxKey = (typeof sfxKeys)[number];

export const isSfxKey = (key: unknown): key is SfxKey => sfxKeys.includes(key as SfxKey);

export type SfxContext = {
  ctx: AudioContext;
  out: AudioNode;
  at: number;
  level: number;
  pan: number;
};

/** Plays `key` from `c.at`, into its own panner and level */
export function playSfx(key: SfxKey, c: SfxContext) {
  const out = gain(c.ctx, c.level * sfxLevel);
  out.connect(panner(c.ctx, c.pan)).connect(c.out);
  sfx[key](c, out);
  window.setTimeout(() => out.disconnect(), (c.at - c.ctx.currentTime + 2) * 1000);
}

const sfx: Record<SfxKey, (c: SfxContext, out: AudioNode) => void> = {
  /** A phaser's zap: a bright tone diving, bent fast by another, with a crackle as it leaves */
  phaser({ ctx, at }, out) {
    const tone = osc(ctx, "sawtooth", 2400);
    tone.frequency.setValueAtTime(2400, at);
    tone.frequency.exponentialRampToValueAtTime(260, at + 0.22);
    const wobble = osc(ctx, "sine", 55);
    wobble.connect(gain(ctx, 380)).connect(tone.frequency);
    const tone2 = osc(ctx, "square", 1800);
    tone2.frequency.setValueAtTime(1800, at);
    tone2.frequency.exponentialRampToValueAtTime(200, at + 0.18);
    const band = filter(ctx, "bandpass", 1800, 1.5);
    band.frequency.setValueAtTime(3000, at);
    band.frequency.exponentialRampToValueAtTime(500, at + 0.22);
    tone.connect(band);
    tone2.connect(gain(ctx, 0.4)).connect(band);
    band.connect(envelope(ctx, at, 0.004, 0.24, 0.5)).connect(out);
    for (const node of [tone, tone2, wobble]) {
      node.start(at);
      node.stop(at + 0.3);
    }
    noise(ctx, at, 0.05, out, 0.25, "highpass", 4000);
  },
  /** A burn: a hiss and crackle that flares then sizzles away, over a soft thump */
  hit({ ctx, at }, out) {
    noise(ctx, at, 0.6, out, 0.5, "highpass", 2500, 0.03);
    crackle(ctx, at, 0.5, out, 14, 0.35);
    const thump = osc(ctx, "sine", 120);
    thump.frequency.setValueAtTime(120, at);
    thump.frequency.exponentialRampToValueAtTime(55, at + 0.12);
    thump.connect(envelope(ctx, at, 0.003, 0.15, 0.45)).connect(out);
    thump.start(at);
    thump.stop(at + 0.25);
  },
  /** A clunk and a chink: a dull knock on plate, and a bright ring off it */
  armour({ ctx, at }, out) {
    const knock = osc(ctx, "sine", 180);
    knock.frequency.setValueAtTime(220, at);
    knock.frequency.exponentialRampToValueAtTime(140, at + 0.05);
    knock.connect(envelope(ctx, at, 0.002, 0.1, 0.6)).connect(out);
    knock.start(at);
    knock.stop(at + 0.2);
    noise(ctx, at, 0.05, out, 0.35, "bandpass", 900);
    chinkPartials.forEach(([hz, level, decay]) => {
      const partial = osc(ctx, "sine", hz);
      partial.connect(envelope(ctx, at + 0.004, 0.001, decay, level)).connect(out);
      partial.start(at);
      partial.stop(at + decay + 0.1);
    });
  },
  /** Static as it passes through them, then the shot striking the wall beyond */
  ghost(c, out) {
    const { ctx, at } = c;
    const buzz = ctx.createBufferSource();
    buzz.buffer = getStatic(ctx);
    const band = filter(ctx, "bandpass", 2200, 0.8);
    const level = envelope(ctx, at, 0.01, staticSecs, 0.4);
    buzz.connect(band).connect(level).connect(out);
    buzz.start(at, Math.random() * 0.4);
    buzz.stop(at + staticSecs + 0.05);
    sfx.wall({ ...c, at: at + staticSecs * 0.6 }, out);
  },
  /** A shot striking a wall: a short crack and thud, and a few sparks */
  wall({ ctx, at }, out) {
    noise(ctx, at, 0.08, out, 0.4, "lowpass", 1400);
    noise(ctx, at, 0.03, out, 0.25, "highpass", 3000);
    const thud = osc(ctx, "sine", 90);
    thud.frequency.setValueAtTime(140, at);
    thud.frequency.exponentialRampToValueAtTime(60, at + 0.08);
    thud.connect(envelope(ctx, at, 0.002, 0.1, 0.35)).connect(out);
    thud.start(at);
    thud.stop(at + 0.2);
    crackle(ctx, at + 0.02, 0.15, out, 5, 0.2);
  },
};

/** A gain rising over `attack` to `level`, then dying away over `decay` */
function envelope(ctx: BaseAudioContext, at: number, attack: number, decay: number, level: number) {
  const node = gain(ctx, 0);
  node.gain.setValueAtTime(0, at);
  node.gain.linearRampToValueAtTime(level, at + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return node;
}

/** A burst of filtered noise from `at`, dying over `secs` */
function noise(
  ctx: AudioContext,
  at: number,
  secs: number,
  dest: AudioNode,
  level: number,
  type: BiquadFilterType,
  hz: number,
  attack = 0.002,
) {
  const source = ctx.createBufferSource();
  source.buffer = getPinkNoise(ctx);
  const shape = filter(ctx, type, hz);
  source
    .connect(shape)
    .connect(envelope(ctx, at, attack, secs, level))
    .connect(dest);
  source.start(at, Math.random() * 0.5);
  source.stop(at + attack + secs + 0.05);
}

/** `count` tiny clicks scattered over `secs`, each a few samples of bright noise */
function crackle(ctx: AudioContext, at: number, secs: number, dest: AudioNode, count: number, level: number) {
  const bright = filter(ctx, "highpass", 3500);
  bright.connect(dest);
  for (let i = 0; i < count; i++) {
    const t = at + Math.random() * secs;
    const click = ctx.createBufferSource();
    click.buffer = getPinkNoise(ctx);
    click.connect(gain(ctx, level * (0.3 + Math.random() * 0.7))).connect(bright);
    click.start(t, Math.random() * 0.9, 0.002 + Math.random() * 0.006);
  }
}

const staticBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Half a second of white noise, chopped into bursts and gaps as a bad signal is */
function getStatic(ctx: BaseAudioContext) {
  const cached = staticBuffers.get(ctx);
  if (cached !== undefined) return cached;
  const buffer = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let on = 1;
  for (let i = 0; i < data.length; i++) {
    if (Math.random() < 0.004) on = Math.random() < 0.7 ? 1 : 0.15;
    data[i] = (Math.random() * 2 - 1) * on;
  }
  staticBuffers.set(ctx, buffer);
  return buffer;
}

/** Every effect's level at full fader, lifting them to about -6 dBFS */
const sfxLevel = 1.6;
/** A struck plate's partials, as `[Hz, level, decay seconds]` */
const chinkPartials: [number, number, number][] = [
  [2350, 0.14, 0.35],
  [3870, 0.1, 0.25],
  [5620, 0.06, 0.18],
];
const staticSecs = 0.35;
