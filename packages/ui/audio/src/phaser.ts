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
  /**
   * A zap of electricity, recorded: a tap higher and cut short, a full charge lower, louder and longer.
   * Its attachment shapes it and adds a layer, and its beam style another (`fireAttachments`, `fireStyles`)
   */
  fire(c, out) {
    const attachment = c.look.attachment ?? "";
    zap(c, out, zapShapes[attachment] ?? zapShapes[""]);
    fireAttachments[attachment]?.(c, out);
    fireStyles[c.look.style]?.(c, out);
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

/** A zap from `c.at` into `out`: its speed, length and level by its charge, scaled by `shape` */
function zap({ ctx, at, pitch, amount: a, sample }: SfxContext, out: AudioNode, shape: ZapShape, delay = 0) {
  const buffer = sample("zap");
  if (buffer === null) return;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = (zapRate[0] + (zapRate[1] - zapRate[0]) * a) * pitch * shape.rate;
  const secs = (zapSecs[0] + (zapSecs[1] - zapSecs[0]) * a) * shape.secs;
  // more body, less fizz
  const body = filter(ctx, "lowshelf", zapBody[0]);
  body.gain.value = zapBody[1];
  const soft = filter(ctx, "highshelf", zapSoft[0]);
  soft.gain.value = zapSoft[1];
  source
    .connect(body)
    .connect(soft)
    .connect(envelope(ctx, at + delay, 0.002, secs, (0.6 + 0.4 * a) * shape.level))
    .connect(out);
  source.start(at + delay);
  source.stop(at + delay + secs + 0.1);
}

/** How an attachment shapes the zap: its speed, length and level, each a ratio. `""` is none */
type ZapShape = { rate: number; secs: number; level: number };
const zapShapes: Record<string, ZapShape> = {
  "": { rate: 1, secs: 1, level: 1 },
  caliber: { rate: 0.9, secs: 0.9, level: 0.9 },
  shotgun: { rate: 0.8, secs: 0.6, level: 1 },
  rotator: { rate: 1.3, secs: 0.22, level: 0.75 },
};

/** Each attachment's layer over the zap */
const fireAttachments: Record<string, SfxBuilder> = {
  /** Parallel rays: a zap either side of the shot's own, panned apart, warmly overdriven, over a tight punchy thump */
  caliber(c, out) {
    const { ctx, at, pitch } = c;
    const rays = warmed(ctx, out);
    for (const [rate, delay, pan] of caliberSides) {
      const side = panner(ctx, pan);
      side.connect(rays);
      zap({ ...c, pitch: pitch * rate }, side, { ...zapShapes.caliber, level: 0.65 }, delay);
    }
    thud(ctx, at, out, 130 * pitch, 60 * pitch, 0.12, 0.55);
  },
  /** Fat: a spread of rays in tight unison, warmly overdriven, over a sub and a heavy thump */
  shotgun(c, out) {
    const { ctx, at, pitch, amount: a } = c;
    const rays = warmed(ctx, out);
    for (const [rate, delay, pan] of shotgunSides) {
      const side = panner(ctx, pan + (Math.random() - 0.5) * 0.15);
      side.connect(rays);
      const varied = rate * (1 + (Math.random() - 0.5) * 0.02);
      zap({ ...c, pitch: pitch * varied }, side, { ...zapShapes.shotgun, level: 0.55 }, delay + Math.random() * 0.004);
    }
    noise(ctx, at, 0.18, rays, 0.25 + 0.1 * a, "lowpass", 3500);
    // weight: a sub sliding down, and a heavy thump
    const sub = osc(ctx, "sawtooth", 60 * pitch);
    sweep(sub.frequency, 60 * pitch, 38 * pitch, at, 0.25);
    sub
      .connect(filter(ctx, "lowpass", 260))
      .connect(envelope(ctx, at, 0.004, 0.28, 0.5))
      .connect(out);
    sub.start(at);
    sub.stop(at + 0.4);
    thud(ctx, at, out, 90 * pitch, 40 * pitch, 0.22, 0.7);
  },
  /** Rapid bolts: the barrel's click as it turns, so held fire rattles */
  rotator({ ctx, at, pitch, sample }, out) {
    layer(ctx, sample("click"), at, out, 0.3, 1.5 * pitch);
  },
};
/** The shotgun's side rays, fanned out in tight unison about the shot: each zap's pitch ratio, seconds behind, and pan */
const shotgunSides = [
  [1.03, 0.002, -0.75],
  [1.012, 0.006, -0.4],
  [0.988, 0.004, 0.4],
  [0.97, 0.008, 0.75],
] as const;
/** The caliber's side rays: each zap's pitch ratio, seconds behind, and pan */
const caliberSides = [
  [1.04, 0.004, -0.5],
  [0.96, 0.009, 0.5],
] as const;

/** Each beam style's layer over the zap, but `plain`'s */
const fireStyles: Record<string, SfxBuilder> = {
  /** Jagged: a sharp snap, then a hissing sizzle crackling all along it */
  lightning({ ctx, at }, out) {
    noise(ctx, at, 0.04, out, 0.7, "highpass", 2000);
    noise(ctx, at + 0.02, 0.35, out, 0.4, "bandpass", 5200, 0.01);
    crackle(ctx, at + 0.01, 0.4, out, 45, 0.9);
  },
  /** Arcing forks: a coil's raspy roar, two arcs overdriven and flickering, a falling zip as it discharges, and sparks */
  tesla({ ctx, at, pitch }, out) {
    const secs = 0.5;
    crackle(ctx, at + 0.01, secs - 0.05, out, 35, 0.8);
    // the arcs: a sawtooth and a square a fifth apart, driven into a rasp
    const roar = envelope(ctx, at, 0.004, secs, 0.5);
    const flicker = gain(ctx, 0.55);
    const shaped = ctx.createWaveShaper();
    shaped.curve = raspCurve;
    shaped
      .connect(filter(ctx, "highpass", 220))
      .connect(flicker)
      .connect(roar)
      .connect(out);
    const arcs = [osc(ctx, "sawtooth", 118 * pitch), osc(ctx, "square", 177 * pitch)];
    arcs[0].connect(shaped);
    arcs[1].connect(gain(ctx, 0.5)).connect(shaped);
    // arcs stutter: slow noise moves the level about
    const wander = ctx.createBufferSource();
    wander.buffer = getPinkNoise(ctx);
    wander
      .connect(filter(ctx, "lowpass", 40))
      .connect(gain(ctx, 1.6))
      .connect(flicker.gain);
    // a falling zip as it discharges
    const zip = osc(ctx, "sawtooth", 2600 * pitch);
    sweep(zip.frequency, 2600 * pitch, 650 * pitch, at, 0.12);
    zip
      .connect(filter(ctx, "highpass", 600))
      .connect(envelope(ctx, at, 0.002, 0.12, 0.22))
      .connect(out);
    for (const node of [...arcs, zip]) {
      node.start(at);
      node.stop(at + secs + 0.1);
    }
    wander.start(at, Math.random() * 0.5);
    wander.stop(at + secs + 0.1);
  },
  /** Flickering: a hum and static hiss cutting in and out irregularly, as a bad connection */
  static({ ctx, at, pitch, sample }, out) {
    const secs = 0.45;
    const gate = gain(ctx, 0);
    gate.connect(envelope(ctx, at, 0.003, secs, 0.8)).connect(out);
    // on or nearly off, for 12 to 35ms at a time
    for (let t = at; t < at + secs; t += 0.012 + Math.random() * 0.023)
      gate.gain.setValueAtTime(Math.random() < 0.65 ? 1 : 0.12, t);
    const hum = osc(ctx, "square", 60 * pitch);
    hum
      .connect(filter(ctx, "lowpass", 900))
      .connect(gain(ctx, 0.3))
      .connect(gate);
    hum.start(at);
    hum.stop(at + secs + 0.1);
    layer(ctx, sample("static"), at, gate, 0.7, 1.3 * pitch);
  },
  /** Dashes racing to the target: three quick falling chirps */
  bolts({ ctx, at, pitch }, out) {
    for (let i = 0; i < 3; i++) {
      const t = at + i * 0.045;
      const chirp = osc(ctx, "sine", 1800 * pitch);
      sweep(chirp.frequency, 1800 * pitch, 550 * pitch, t, 0.05);
      chirp.connect(envelope(ctx, t, 0.002, 0.05, 0.35)).connect(out);
      chirp.start(t);
      chirp.stop(t + 0.1);
    }
  },
};

/** A waveshaper's curve, soft clipping by `drive`, scaled to reach `±1` */
function tanhCurve(drive: number) {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++)
    curve[i] = Math.tanh(drive * ((2 * i) / (curve.length - 1) - 1)) / Math.tanh(drive);
  return curve;
}

/** A warm overdrive, gently rounding the caliber's and shotgun's rays */
const warmCurve = tanhCurve(2.2);

/** A bus into `out` through the warm overdrive, for rays to thicken */
function warmed(ctx: AudioContext, out: AudioNode) {
  const rays = gain(ctx, 1);
  const warm = ctx.createWaveShaper();
  warm.curve = warmCurve;
  rays.connect(warm).connect(out);
  return rays;
}

/** A thump: a sine falling from `from` to `to` Hz over `secs` */
function thud(ctx: AudioContext, at: number, out: AudioNode, from: number, to: number, secs: number, level: number) {
  const knock = osc(ctx, "sine", from);
  sweep(knock.frequency, from, to, at, secs * 0.8);
  knock.connect(envelope(ctx, at, 0.002, secs, level)).connect(out);
  knock.start(at);
  knock.stop(at + secs + 0.1);
}

/** A rasp: soft clipping hard into overdrive, for the tesla's arcs */
const raspCurve = tanhCurve(6);

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
