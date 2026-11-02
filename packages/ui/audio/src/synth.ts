import { filter, gain, getPinkNoise } from "./nodes";

/** Every effect's level at full fader, lifting them to about -6 dBFS */
export const sfxLevel = 1.6;

/** A gain rising over `attack` to `level`, then dying away over `decay` */
export function envelope(ctx: BaseAudioContext, at: number, attack: number, decay: number, level: number) {
  const node = gain(ctx, 0);
  node.gain.setValueAtTime(0, at);
  node.gain.linearRampToValueAtTime(level, at + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return node;
}

/** `param` from `from` at `at`, bending to `to` over `secs` */
export function sweep(param: AudioParam, from: number, to: number, at: number, secs: number) {
  param.setValueAtTime(from, at);
  param.exponentialRampToValueAtTime(to, at + secs);
}

/** A burst of filtered noise from `at`, dying over `secs` */
export function noise(
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
export function crackle(ctx: AudioContext, at: number, secs: number, dest: AudioNode, count: number, level: number) {
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

/** A sine struck at `at`: `hz` and a fainter partial above it, ringing for `decay` */
export function ping(ctx: AudioContext, at: number, hz: number, dest: AudioNode, level: number, decay: number) {
  for (const [ratio, share] of pingPartials) {
    const tone = ctx.createOscillator();
    tone.frequency.value = hz * ratio;
    tone.connect(envelope(ctx, at, 0.001, decay * share, level * share)).connect(dest);
    tone.start(at);
    tone.stop(at + decay + 0.05);
  }
}

/** A recorded sample from `at`, `rate` its speed and so its pitch */
export function playBuffer(
  ctx: AudioContext,
  buffer: AudioBuffer,
  at: number,
  dest: AudioNode,
  level: number,
  rate = 1,
) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  source.connect(gain(ctx, level)).connect(dest);
  source.start(at);
}

const staticBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Half a second of white noise, chopped into bursts and gaps as a bad signal is */
export function getStatic(ctx: BaseAudioContext) {
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

/** A struck ping's partials, as `[frequency ratio, share of its level and decay]` */
const pingPartials: [number, number][] = [
  [1, 1],
  [2.76, 0.35],
];
