import { filter, gain, getPinkNoise, osc, panner } from "./nodes";
import type { HeldVoice, HoldParams, SfxBuilder, SfxContext } from "./sfx";
import { envelope, layer, sfxLevel, sweep } from "./synth";

/** How a door sounds as it moves: a rail's rumble, else that with a soft hiss of air */
export const doorVoices = ["glide", "air"] as const;
export type DoorVoice = (typeof doorVoices)[number];

export const isDoorVoice = (voice: unknown): voice is DoorVoice => doorVoices.includes(voice as DoorVoice);

/** A door's sounds besides its moving — see `docs/audio.md` */
export const doorSfx = {
  /** A door stopping, open: a recorded clunk, louder the faster it came */
  opened: stop,
  /** A door stopping, shut */
  closed: stop,
  /** A bolt shot home, recorded */
  lock({ ctx, at, pitch, sample }, out) {
    layer(ctx, sample("lock"), at, out, 0.8, pitch);
  },
  /** The same bolt drawn back, a little higher */
  unlock({ ctx, at, pitch, sample }, out) {
    layer(ctx, sample("lock"), at, out, 0.7, 1.15 * pitch);
  },
  /** A latch catching, and a low tone settling */
  hold({ ctx, at, pitch, sample }, out) {
    layer(ctx, sample("click"), at, out, 0.4, pitch);
    hum(ctx, at + 0.03, out, 90 * pitch, 120 * pitch, 0.35);
  },
  /** The low tone falling away, and the latch let go */
  unhold({ ctx, at, pitch, sample }, out) {
    hum(ctx, at, out, 120 * pitch, 80 * pitch, 0.3);
    layer(ctx, sample("click"), at + 0.18, out, 0.35, 1.1 * pitch);
  },
  /** A low buzz, twice */
  denied({ ctx, at, pitch }, out) {
    for (const t of [0, 0.16]) {
      const buzz = osc(ctx, "square", 140 * pitch);
      buzz
        .connect(filter(ctx, "lowpass", 900))
        .connect(gate(ctx, at + t, 0.11, 0.2))
        .connect(out);
      buzz.start(at + t);
      buzz.stop(at + t + 0.15);
    }
  },
} satisfies Record<string, SfxBuilder>;

/** A door moving, held whilst it moves, `level` its speed: a rail's rumble, brighter and louder the faster, maybe with air */
export function doorVoice(ctx: AudioContext, dest: AudioNode, { voice = "glide" }: HoldParams): HeldVoice {
  const out = gain(ctx, 0);
  const place = panner(ctx, 0);
  out.connect(place).connect(dest);
  const sources: AudioScheduledSourceNode[] = [];
  const loop = () => {
    const source = ctx.createBufferSource();
    source.buffer = getPinkNoise(ctx);
    source.loop = true;
    source.start(0, Math.random() * 0.5);
    sources.push(source);
    return source;
  };
  const rumble = filter(ctx, "lowpass", 120);
  loop().connect(rumble).connect(out);
  /** Each param eased with speed, as `[param, at rest, at full speed]` */
  const bySpeed: [AudioParam, number, number][] = [[rumble.frequency, 120, 620]];

  if (voice === "air") {
    const hiss = filter(ctx, "bandpass", 900, 0.7);
    const hissLevel = gain(ctx, 0);
    loop().connect(hiss).connect(hissLevel).connect(out);
    bySpeed.push([hiss.frequency, 900, 1600], [hissLevel.gain, 0, 0.5]);
  }
  const ease = (param: AudioParam, value: number, at: number) => param.setTargetAtTime(value, at, 0.03);

  return {
    set({ level, pan, gain: heard }, at) {
      for (const [param, rest, full] of bySpeed) ease(param, rest + (full - rest) * level, at);
      ease(place.pan, Math.max(-1, Math.min(1, pan)), at);
      ease(out.gain, heard * doorLevel * level * sfxLevel, at);
    },
    stop(at) {
      out.gain.cancelScheduledValues(at);
      out.gain.setTargetAtTime(0, at, 0.03);
      for (const source of sources) source.stop(at + 0.25);
      window.setTimeout(() => out.disconnect(), (at - ctx.currentTime + 0.3) * 1000);
    },
  };
}

/** A moving door's level at full speed, out of the world fader */
const doorLevel = 0.6;
/** A door meeting its stop: a recorded clunk, louder the faster it came */
function stop({ ctx, at, pitch, amount, sample }: SfxContext, out: AudioNode) {
  layer(ctx, sample("clunk"), at, out, 0.3 + 0.5 * amount, pitch);
}

/** A gain held at `level` for `secs` from `at`, with short ramps so it does not click */
function gate(ctx: BaseAudioContext, at: number, secs: number, level: number) {
  const node = gain(ctx, 0);
  node.gain.setValueAtTime(0, at);
  node.gain.linearRampToValueAtTime(level, at + 0.005);
  node.gain.setValueAtTime(level, at + secs - 0.01);
  node.gain.linearRampToValueAtTime(0, at + secs);
  return node;
}

/** A low tone and its octave, gliding from `from` to `to` Hz over `secs` */
function hum(ctx: AudioContext, at: number, out: AudioNode, from: number, to: number, secs: number) {
  for (const ratio of [1, 2]) {
    const tone = osc(ctx, "sine", from * ratio);
    sweep(tone.frequency, from * ratio, to * ratio, at, secs);
    tone.connect(envelope(ctx, at, 0.02, secs, 0.15 / ratio)).connect(out);
    tone.start(at);
    tone.stop(at + secs + 0.1);
  }
}
