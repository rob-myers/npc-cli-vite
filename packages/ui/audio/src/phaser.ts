import { filter, gain, getPinkNoise, osc, panner, shaper } from "./nodes";
import type { HeldVoice, SfxBuilder } from "./sfx";
import { crackle, envelope, getStatic, layer, noise, sfxLevel, sweep } from "./synth";

/** A phaser's sounds, from raising it to where its shot ends — see `docs/audio.md` */
export const phaserSfx = {
  /** A sleeve's rustle, a leather grip taking it, and a click as it settles in the hand */
  raise({ ctx, at, pitch, sample }, out) {
    layer(ctx, sample("cloth"), at, out, 0.4, pitch);
    layer(ctx, sample("grip"), at + 0.04, out, 0.6, pitch);
    layer(ctx, sample("click"), at + 0.2, out, 0.35, 1.2 * pitch);
    heft(ctx, at + 0.2, out, 0.25);
  },
  /** A click as it is made safe, a rustle, and the leather taking it back */
  lower({ ctx, at, pitch, sample }, out) {
    layer(ctx, sample("click"), at, out, 0.3, 1.1 * pitch);
    layer(ctx, sample("cloth"), at + 0.05, out, 0.35, pitch);
    layer(ctx, sample("grip"), at + 0.14, out, 0.5, 0.9 * pitch);
    heft(ctx, at + 0.18, out, 0.2);
  },
  /** A snap of current as it holds at full */
  charged({ ctx, at }, out) {
    noise(ctx, at, 0.03, out, 0.3, "bandpass", 3200);
    crackle(ctx, at, 0.06, out, 6, 0.35);
  },
  /** A discharge: a recorded crack, a short distorted burst, and a sizzle. Charged, a low boom under it */
  fire({ ctx, at, pitch, amount: a, sample }, out) {
    layer(ctx, sample("crunch"), at, out, 0.35, 1.5 * pitch);
    noise(ctx, at, 0.025, out, 0.5, "highpass", 2000);
    const secs = 0.08 + 0.15 * a;
    const grit = shaper(ctx, 6 + 6 * a);
    grit
      .connect(filter(ctx, "bandpass", 1800, 0.7))
      .connect(envelope(ctx, at, 0.002, secs, 0.35))
      .connect(out);
    for (const [ratio, detune] of [
      [1, 0],
      [1.5, 12],
    ]) {
      const buzz = osc(ctx, "sawtooth", 100 * ratio * pitch);
      buzz.detune.value = detune;
      buzz.connect(grit);
      buzz.start(at);
      buzz.stop(at + secs + 0.1);
    }
    crackle(ctx, at, secs + 0.1, out, Math.round(6 + 10 * a), 0.3);
    noise(ctx, at + 0.02, 0.25 + 0.3 * a, out, 0.12, "highpass", 6000, 0.01);
    if (a >= 0.3) layer(ctx, sample("boom"), at, out, 0.6 * a, 1.2 * pitch);
  },
  /** A cancelled charge: its buzz darkening and dying, crackling, with a hiss of venting */
  cool({ ctx, at, pitch, amount }, out) {
    const a = Math.max(0.3, amount);
    const secs = 0.6;
    const buzz = osc(ctx, "sawtooth", chargeHz * pitch);
    const dark = filter(ctx, "lowpass", chargeCutoff(a));
    sweep(dark.frequency, chargeCutoff(a), 150, at, secs);
    buzz
      .connect(shaper(ctx, 2))
      .connect(dark)
      .connect(envelope(ctx, at, 0.005, secs, 0.3 * a))
      .connect(out);
    buzz.start(at);
    buzz.stop(at + secs + 0.1);
    crackle(ctx, at, secs * 0.8, out, Math.round(6 + 8 * a), 0.25);
    noise(ctx, at + 0.02, 0.5, out, 0.2 * a, "bandpass", 2500, 0.04);
  },
  /** A burn: a hiss and crackle that flares then sizzles away, over a soft thump and a wet sear */
  hit({ ctx, at, pitch, sample }, out) {
    noise(ctx, at, 0.6, out, 0.5, "highpass", 2500, 0.03);
    crackle(ctx, at, 0.5, out, 14, 0.35);
    const thump = osc(ctx, "sine", 120);
    sweep(thump.frequency, 120 * pitch, 55 * pitch, at, 0.12);
    thump.connect(envelope(ctx, at, 0.003, 0.15, 0.45)).connect(out);
    thump.start(at);
    thump.stop(at + 0.25);
    const thin = filter(ctx, "highpass", 600);
    thin.connect(out);
    layer(ctx, sample("slime"), at, thin, 0.35, 1.3 * pitch);
  },
  /** Struck plate, recorded and pitched down, over a padded thud and a low knock */
  armour({ ctx, at, pitch, sample }, out) {
    layer(ctx, sample("armour"), at, out, 0.8, 0.85 * pitch);
    layer(ctx, sample("thud"), at, out, 0.6, 0.9 * pitch);
    noise(ctx, at, 0.06, out, 0.35, "lowpass", 900);
    const knock = osc(ctx, "sine", 110);
    sweep(knock.frequency, 110 * pitch, 60 * pitch, at, 0.1);
    knock.connect(envelope(ctx, at, 0.002, 0.14, 0.5)).connect(out);
    knock.start(at);
    knock.stop(at + 0.25);
  },
  /** A phase shift as it passes through them: notches sweeping through a rush, two tones drifting apart, then the wall beyond */
  ghost(c, out) {
    const { ctx, at, pitch } = c;
    const shift = phaseShifter(ctx, at, ghostSecs);
    shift.output.connect(envelope(ctx, at, 0.002, ghostSecs, 0.6)).connect(out);
    const rush = ctx.createBufferSource();
    rush.buffer = getPinkNoise(ctx);
    rush
      .connect(filter(ctx, "highpass", 400))
      .connect(gain(ctx, 0.5))
      .connect(shift.input);
    rush.start(at, Math.random() * 0.5);
    rush.stop(at + ghostSecs + 0.05);
    for (const drift of [1, 1.05]) {
      const tone = osc(ctx, "sine", 520 * pitch);
      sweep(tone.frequency, 520 * pitch, 520 * drift * pitch, at, ghostSecs);
      tone.connect(gain(ctx, 0.12)).connect(shift.input);
      tone.start(at);
      tone.stop(at + ghostSecs + 0.05);
    }
    const beyond = gain(ctx, 0.7);
    beyond.connect(out);
    phaserSfx.wall({ ...c, at: at + 0.02 }, beyond);
  },
  /** A shot striking a wall: a recorded crunch, a thud, and a few sparks */
  wall({ ctx, at, pitch, sample }, out) {
    layer(ctx, sample("crunch"), at, out, 0.5, 1.1 * pitch);
    noise(ctx, at, 0.03, out, 0.25, "highpass", 3000);
    const thud = osc(ctx, "sine", 90);
    sweep(thud.frequency, 140 * pitch, 60 * pitch, at, 0.08);
    thud.connect(envelope(ctx, at, 0.002, 0.1, 0.35)).connect(out);
    thud.start(at);
    thud.stop(at + 0.2);
    crackle(ctx, at + 0.02, 0.15, out, 5, 0.2);
  },
} satisfies Record<string, SfxBuilder>;

/** A phaser charging: a steady buzz and a rush of current, brightening and crackling as it fills */
export function chargeVoice(ctx: AudioContext, dest: AudioNode): HeldVoice {
  const out = gain(ctx, 0);
  const place = panner(ctx, 0);
  out.connect(place).connect(dest);
  const bright = filter(ctx, "lowpass", chargeCutoff(0), 1.2);
  bright.connect(shaper(ctx, 2)).connect(out);
  const buzzes = [0, 25].map((detune) => {
    const buzz = osc(ctx, "sawtooth", chargeHz);
    buzz.detune.value = detune;
    buzz.connect(bright);
    return buzz;
  });
  const rush = ctx.createBufferSource();
  rush.buffer = getPinkNoise(ctx);
  rush.loop = true;
  const rushBand = filter(ctx, "bandpass", 800, 0.8);
  const rushLevel = gain(ctx, 0);
  rush.connect(rushBand).connect(rushLevel).connect(out);
  const sparks = ctx.createBufferSource();
  sparks.buffer = getStatic(ctx);
  sparks.loop = true;
  const sparksLevel = gain(ctx, 0);
  sparks
    .connect(filter(ctx, "highpass", 3000))
    .connect(sparksLevel)
    .connect(out);
  const sources = [...buzzes, rush, sparks];
  for (const node of sources) node.start();
  const ease = (param: AudioParam, value: number, at: number) => param.setTargetAtTime(value, at, 0.04);

  return {
    set({ level, pan, gain: heard }, at) {
      ease(bright.frequency, chargeCutoff(level), at);
      ease(rushBand.frequency, 800 + 1700 * level, at);
      ease(rushLevel.gain, 0.2 + 0.8 * level, at);
      ease(sparksLevel.gain, level >= 1 ? 0.12 : 0.08 * level, at);
      ease(place.pan, Math.max(-1, Math.min(1, pan)), at);
      ease(out.gain, heard * (0.04 + 0.16 * level) * sfxLevel, at);
    },
    stop(at) {
      out.gain.cancelScheduledValues(at);
      out.gain.setTargetAtTime(0, at, 0.03);
      for (const node of sources) node.stop(at + 0.25);
      window.setTimeout(() => out.disconnect(), (at - ctx.currentTime + 0.3) * 1000);
    },
  };
}

/** The charging buzz's pitch, steady as it fills */
const chargeHz = 100;
/** How bright the charging buzz is at `level`, `0` to `1` */
const chargeCutoff = (level: number) => 250 + 2250 * level;

/** The weight of it meeting the hand: a soft low knock */
function heft(ctx: AudioContext, at: number, out: AudioNode, level: number) {
  const knock = osc(ctx, "sine", 160);
  sweep(knock.frequency, 160, 90, at, 0.06);
  knock.connect(envelope(ctx, at, 0.003, 0.08, level)).connect(out);
  knock.start(at);
  knock.stop(at + 0.15);
}

/** All-pass stages swept up then back over `secs`, mixed with the dry: notches moving through, as a phase shifting */
function phaseShifter(ctx: AudioContext, at: number, secs: number) {
  const input = gain(ctx, 1);
  const output = gain(ctx, 0.5);
  input.connect(output);
  let stage: AudioNode = input;
  for (let i = 0; i < phaseStages; i++) {
    const pass = filter(ctx, "allpass", 300, 0.7);
    pass.frequency.setValueAtTime(300, at);
    pass.frequency.exponentialRampToValueAtTime(5000, at + secs * 0.5);
    pass.frequency.exponentialRampToValueAtTime(600, at + secs);
    stage = stage.connect(pass);
  }
  stage.connect(output);
  return { input, output };
}

const phaseStages = 8;
const ghostSecs = 0.35;
