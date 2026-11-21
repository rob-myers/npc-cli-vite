import { filter, gain, getPinkNoise, osc, panner } from "./nodes";
import type { HeldVoice, SfxBuilder, SfxContext } from "./sfx";
import { crackle, envelope, layer, noise, sfxLevel, sweep } from "./synth";

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
  /** A zap of electricity, recorded: a tap higher and cut short, a full charge lower, louder and longer */
  fire({ ctx, at, pitch, amount: a, sample }, out) {
    const zap = sample("zap");
    if (zap === null) return;
    const source = ctx.createBufferSource();
    source.buffer = zap;
    source.playbackRate.value = (zapRate[0] + (zapRate[1] - zapRate[0]) * a) * pitch;
    const secs = zapSecs[0] + (zapSecs[1] - zapSecs[0]) * a;
    // more body, less fizz
    const body = filter(ctx, "lowshelf", zapBody[0]);
    body.gain.value = zapBody[1];
    const soft = filter(ctx, "highshelf", zapSoft[0]);
    soft.gain.value = zapSoft[1];
    source
      .connect(body)
      .connect(soft)
      .connect(envelope(ctx, at, 0.002, secs, 0.6 + 0.4 * a))
      .connect(out);
    source.start(at);
    source.stop(at + secs + 0.1);
  },
  /** A cancelled charge: its pulse slowing, sinking and fading, the air falling away */
  cool({ ctx, at, pitch, amount }, out) {
    const a = Math.max(0.3, amount);
    const secs = 0.6;
    const hz = between(pulse.hz, a) * pitch;
    const tone = osc(ctx, "sine", hz);
    sweep(tone.frequency, hz, pulse.hz[0] * 0.7 * pitch, at, secs);
    const throb = gain(ctx, 0.5);
    const rate = osc(ctx, "sine", between(pulse.rate, a));
    sweep(rate.frequency, between(pulse.rate, a), 2, at, secs);
    rate.connect(gain(ctx, 0.5)).connect(throb.gain);
    tone
      .connect(throb)
      .connect(envelope(ctx, at, 0.005, secs, 0.5 * a))
      .connect(out);
    for (const node of [tone, rate]) {
      node.start(at);
      node.stop(at + secs + 0.1);
    }
    noise(ctx, at, secs * 0.8, out, 0.25 * a, "bandpass", between(pulse.air, a) * 0.7, 0.01);
  },
  /** An electric hum, recorded: a shot striking anyone, or a wall */
  hit({ ctx, at, pitch, sample }, out) {
    layer(ctx, sample("shock"), at, out, 0.8, pitch);
  },
  /** Struck plate, the shot's charge humming into it as it's soaked up, sparks, and a low knock */
  armour(c, out) {
    const { ctx, at, pitch, sample } = c;
    layer(ctx, sample("armour"), at, out, 0.85, 0.85 * pitch);
    absorb(c, out);
    crackle(ctx, at + 0.01, 0.25, out, 10, 0.25);
    const knock = osc(ctx, "sine", 110);
    sweep(knock.frequency, 110 * pitch, 60 * pitch, at, 0.1);
    knock.connect(envelope(ctx, at, 0.002, 0.14, 0.5)).connect(out);
    knock.start(at);
    knock.stop(at + 0.25);
  },
  /** A shot striking a wall, or anything but someone: its charge soaked up, without the armour's plate or sparks */
  struck(c, out) {
    absorb(c, out, struckSecs);
  },
  /** Static as it passes through them, recorded, then the shot striking the wall beyond */
  ghost(c, out) {
    const { ctx, at, pitch, sample } = c;
    layer(ctx, sample("static"), at, out, 0.7, pitch);
    const beyond = gain(ctx, 0.7);
    beyond.connect(out);
    absorb({ ...c, at: at + ghostBeyondSecs }, beyond, struckSecs); // as `struck`
  },
} satisfies Record<string, SfxBuilder>;

/** A phaser charging: a low tone throbbing faster as it fills, with a swell of air */
export function chargeVoice(ctx: AudioContext, dest: AudioNode): HeldVoice {
  const out = gain(ctx, 0);
  const place = panner(ctx, 0);
  out.connect(place).connect(dest);
  const tone = osc(ctx, "sine", pulse.hz[0]);
  const throb = gain(ctx, 0.5);
  const rate = osc(ctx, "sine", pulse.rate[0]);
  rate.connect(gain(ctx, 0.5)).connect(throb.gain);
  tone.connect(throb).connect(out);
  const air = ctx.createBufferSource();
  air.buffer = getPinkNoise(ctx);
  air.loop = true;
  const band = filter(ctx, "bandpass", pulse.air[0], 0.7);
  const airLevel = gain(ctx, 0.1);
  air.connect(band).connect(airLevel).connect(out);
  const sources = [tone, rate, air];
  for (const source of sources) source.start();
  const ease = (param: AudioParam, value: number, at: number) => param.setTargetAtTime(value, at, 0.04);

  return {
    set({ level, pan, gain: heard }, at) {
      ease(tone.frequency, between(pulse.hz, level), at);
      ease(rate.frequency, between(pulse.rate, level), at);
      ease(band.frequency, between(pulse.air, level), at);
      ease(airLevel.gain, 0.1 + 0.5 * level, at);
      ease(place.pan, Math.max(-1, Math.min(1, pan)), at);
      ease(out.gain, heard * (0.04 + 0.16 * level) * sfxLevel, at);
    },
    stop(at) {
      out.gain.cancelScheduledValues(at);
      out.gain.setTargetAtTime(0, at, 0.03);
      for (const source of sources) source.stop(at + 0.25);
      window.setTimeout(() => out.disconnect(), (at - ctx.currentTime + 0.3) * 1000);
    },
  };
}

/** The charge's pulse, each `[empty, full]`: the tone's Hz, its throbs a second, and the air's band */
const pulse = { hz: [55, 90], rate: [3, 18], air: [400, 1800] } as const;
/** From `empty` to `full` by `level`, evenly in pitch */
const between = ([empty, full]: readonly [number, number], level: number) => empty * (full / empty) ** level;

/** The weight of it meeting the hand: a soft low knock */
function heft(ctx: AudioContext, at: number, out: AudioNode, level: number) {
  const knock = osc(ctx, "sine", 160);
  sweep(knock.frequency, 160, 90, at, 0.06);
  knock.connect(envelope(ctx, at, 0.003, 0.08, level)).connect(out);
  knock.start(at);
  knock.stop(at + 0.15);
}

/** Seconds into a ghost's static that the shot strikes beyond */
const ghostBeyondSecs = 0.15;
/** A zap's speed and how long it lasts, as `[a tap, a full charge]` */
const zapRate = [1, 0.8];
const zapSecs = [0.7, 1.2];
/** A zap's low shelf, lifting its body, and its high shelf, easing its fizz, as `[Hz, dB]` */
const zapBody = [250, 6];
const zapSoft = [6000, -3];

/** A shot's charge humming into what it struck as it's soaked up: its recorded shock cut short, and a buzz sinking */
function absorb({ ctx, at, pitch, sample }: SfxContext, out: AudioNode, secs = absorbSecs) {
  const hum = envelope(ctx, at, 0.005, secs, 1); // the recording is long: only its start is heard
  hum.connect(out);
  layer(ctx, sample("shock"), at, hum, 0.2, 0.6 * pitch);
  const buzz = osc(ctx, "sawtooth", 120 * pitch);
  sweep(buzz.frequency, 120 * pitch, 70 * pitch, at, secs);
  buzz
    .connect(filter(ctx, "lowpass", 1200))
    .connect(gain(ctx, 0.08))
    .connect(hum);
  buzz.start(at);
  buzz.stop(at + secs + 0.1);
}

/** Seconds a shot's charge hums into what it struck for, sinking as it is soaked up: armour, else a wall or door */
const absorbSecs = 0.2;
const struckSecs = 0.45;
