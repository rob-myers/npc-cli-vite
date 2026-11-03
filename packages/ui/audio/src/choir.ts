import { filter, gain, getPinkNoise, hall, osc, panner } from "./nodes";
import type { SampleBank } from "./samples";
import type { HeldVoice, HoldParams } from "./sfx";
import { sfxLevel } from "./synth";

/** What sings whilst psi is raised, chosen on the desk: the choir, the monk, a chant (`psi`'s, in order), else any */
export const psiVoices = ["random", "choir", "monk", "low-d", "low-chant", "drone", "eerie"] as const;
export type PsiVoice = (typeof psiVoices)[number];

export const isPsiVoice = (voice: unknown): voice is PsiVoice => psiVoices.includes(voice as PsiVoice);

/** A chant's place in the `psi` bank, else `null` for the choir or random */
export function chantOf(voice: PsiVoice) {
  const at = psiVoices.indexOf(voice) - psiVoices.indexOf("low-d");
  return at >= 0 ? at : null;
}

/**
 * A deep choir, held whilst the player's psi is raised, chanting as monks do: low voices over a bass, in groups
 * each with their own mouths, spread across a stone hall, in phrases of "aum", overtones whistling above them,
 * and a bowl struck now and then.
 */
export function choirVoice(ctx: AudioContext, dest: AudioNode): HeldVoice {
  const out = gain(ctx, 0);
  out.connect(dest);
  const room = gain(ctx, 1);
  room.connect(out);
  room.connect(gain(ctx, choirHallWet)).connect(hall(ctx)).connect(out);
  const sources: AudioScheduledSourceNode[] = [];
  const start = <T extends AudioScheduledSourceNode>(source: T) => {
    source.start();
    sources.push(source);
    return source;
  };
  /** Noise, slowly wandering, from a different place each time */
  const wander = (hz: number) => {
    const noise = ctx.createBufferSource();
    noise.buffer = getPinkNoise(ctx);
    noise.loop = true;
    noise.start(0, Math.random() * 0.9);
    sources.push(noise);
    return noise.connect(filter(ctx, "lowpass", hz));
  };
  const throat = getThroat(ctx);
  /** A share from `low` to `high`, a singer's own */
  const own = (low: number, high: number) => low + (high - low) * Math.random();

  const groups = mouthScales.map((scale, g) => {
    // the singers of this group, each holding their note a little unsteadily
    const voices = gain(ctx, 1 / (chordHz.length * singers));
    const singing = chordHz.flatMap((hz) =>
      Array.from({ length: singers }, (_, i) => {
        // each their own: a voice brighter or darker, more or less steady, louder or softer
        const singer = start(osc(ctx, "sine", hz));
        singer.setPeriodicWave(getThroat(ctx, throatTilts[Math.floor(Math.random() * throatTilts.length)]));
        const detune = (i - (singers - 1) / 2) * detuneCents + g * groupCents + own(-detuneStray, detuneStray);
        singer.detune.value = detune;
        wander(driftHz)
          .connect(gain(ctx, driftCents * own(0.5, 1.5)))
          .connect(singer.detune);
        const vibrato = start(osc(ctx, "sine", vibratoHz * own(0.75, 1.25)));
        vibrato.connect(gain(ctx, hz * vibratoDepth * own(0.5, 2))).connect(singer.frequency);
        singer
          .connect(gain(ctx, own(0.6, 1.2)))
          .connect(panner(ctx, spread * own(-1, 1)))
          .connect(voices);
        return { singer, detune };
      }),
    );
    wander(8000).connect(gain(ctx, breathiness)).connect(voices);
    const phrase = gain(ctx, phraseRest);
    phrase.connect(room);
    // their mouths, a little longer or shorter than the next group's
    const mouth = gain(ctx, formantLift);
    const bands = vowels.a.map(([hz, q, share]) => {
      const band = filter(ctx, "bandpass", hz * scale, q);
      voices.connect(band).connect(gain(ctx, share)).connect(mouth);
      return band;
    });
    const lips = filter(ctx, "lowpass", lipsHz.a * scale);
    mouth.connect(lips).connect(phrase);
    return { scale, singing, voices, phrase, bands, lips, late: g * staggerSecs };
  });

  // overtones, a narrow resonance drifting over the drone, heard through closed lips too
  const overtone = filter(ctx, "bandpass", (overtoneHz[0] + overtoneHz[1]) / 2, overtoneQ);
  const drift = start(osc(ctx, "sine", overtoneDriftHz));
  drift.connect(gain(ctx, (overtoneHz[1] - overtoneHz[0]) / 2)).connect(overtone.frequency);
  overtone.connect(gain(ctx, overtoneShare)).connect(groups[0].phrase);
  for (const { voices } of groups) voices.connect(overtone);

  // basses an octave under the root, beneath the vowel
  const basses = gain(ctx, bassShare / bassSingers);
  basses.connect(filter(ctx, "lowpass", 150)).connect(groups[0].phrase);
  const bassing = Array.from({ length: bassSingers }, (_, i) => {
    const bass = start(osc(ctx, "sine", bassHz));
    bass.setPeriodicWave(throat);
    const detune = (i - (bassSingers - 1) / 2) * detuneCents;
    bass.detune.value = detune;
    wander(driftHz).connect(gain(ctx, driftCents)).connect(bass.detune);
    bass.connect(basses);
    return { bass, detune };
  });

  /** Where the chant's melody is in its mode, walked a step or two each note */
  let degree = home;
  /**
   * One phrase, each group a little after the last: a breath in, a scoop up onto its note, one of `chants`, a step to
   * another note, a fall to close, then easing for a breath
   */
  const sing = (at: number) => {
    const chant = chants[Math.floor(Math.random() * chants.length)];
    // a note, a step to another halfway, then a fall to close
    const [first, second] = [modeCents[(degree = walk(degree))], modeCents[(degree = walk(degree))]];
    const close = modeCents[Math.max(0, degree - 1)];
    const [stepAt, closeAt] = [at + phraseSecs * stepShare, at + phraseSecs - breathSecs - closeSecs];
    /** Moves `param`, a voice's detune from its own `detune`, along the phrase's notes */
    const follow = (param: AudioParam, detune: number, from: number) => {
      param.setTargetAtTime(detune + second, stepAt + (from - at), glideSecs);
      param.setTargetAtTime(detune + close, closeAt + (from - at), glideSecs);
    };
    for (const { bass, detune } of bassing) {
      bass.detune.setTargetAtTime(detune + first, at, scoopSecs);
      follow(bass.detune, detune, at);
    }
    for (const { scale, singing, phrase, bands, lips, late } of groups) {
      const from = at + late;
      const inhale = gain(ctx, 0);
      const breath = ctx.createBufferSource();
      breath.buffer = getPinkNoise(ctx);
      breath
        .connect(filter(ctx, "lowpass", 1200))
        .connect(inhale)
        .connect(phrase);
      inhale.gain.setTargetAtTime(inhaleLevel, from - inhaleSecs, inhaleSecs / 3);
      inhale.gain.setTargetAtTime(0, from, 0.1);
      breath.start(Math.max(ctx.currentTime, from - inhaleSecs), Math.random() * 0.3);
      breath.stop(from + 0.5);
      breath.onended = () => inhale.disconnect();
      for (const { singer, detune } of singing) {
        singer.detune.setValueAtTime(detune + first - scoopCents, from);
        singer.detune.setTargetAtTime(detune + first, from, scoopSecs);
        follow(singer.detune, detune, from);
      }
      for (const [vowel, after, secs] of chant) {
        vowels[vowel].forEach(([hz], i) => bands[i].frequency.setTargetAtTime(hz * scale, from + after, secs));
        lips.frequency.setTargetAtTime(lipsHz[vowel] * scale, from + after, secs);
      }
      phrase.gain.setTargetAtTime(1, from, 0.25);
      phrase.gain.setTargetAtTime(phraseRest, from + phraseSecs - breathSecs, 0.4);
    }
  };

  const timers = { phrase: 0, bowl: 0 };
  const chant = (at: number) => {
    sing(at);
    const next = at + phraseSecs;
    timers.phrase = window.setTimeout(() => chant(next), (next - ctx.currentTime - 1) * 1000);
  };
  const ring = (at: number) => {
    strikeBowl(ctx, at, room);
    const next = at + bowlSecs * (0.8 + 0.4 * Math.random());
    timers.bowl = window.setTimeout(() => ring(next), (next - ctx.currentTime - 0.5) * 1000);
  };
  chant(ctx.currentTime + inhaleSecs);
  timers.bowl = window.setTimeout(() => ring(ctx.currentTime + 0.5), firstBowlSecs * 1000);

  const choirOut = held(ctx, out, sources, choirLevel);
  return {
    set: choirOut.set,
    stop(at) {
      window.clearTimeout(timers.phrase);
      window.clearTimeout(timers.bowl);
      choirOut.stop(at);
    },
  };
}

/** A singing bowl struck: its partials, each a pair beating, ringing out */
function strikeBowl(ctx: AudioContext, at: number, out: AudioNode) {
  for (const [ratio, share, ring] of bowlPartials) {
    for (const beat of [0, bowlBeatHz]) {
      const tone = osc(ctx, "sine", bowlHz * ratio + beat);
      const fade = gain(ctx, 0);
      fade.gain.setValueAtTime(0, at);
      fade.gain.linearRampToValueAtTime((bowlLevel * share) / 2, at + 0.01);
      fade.gain.setTargetAtTime(0, at + 0.01, ring / 4);
      tone.connect(fade).connect(out);
      tone.start(at);
      tone.stop(at + ring);
      tone.onended = () => fade.disconnect();
    }
  }
}

/**
 * A monk chanting, held whilst the player's psi is raised: one low voice in a vast stone hall, in phrases of "aum",
 * its overtones whistling above it, and a bowl struck now and then.
 */
export function monkVoice(ctx: AudioContext, dest: AudioNode): HeldVoice {
  const out = gain(ctx, 0);
  out.connect(dest);
  // mostly the hall, after a moment: the voice is far off in it
  const room = gain(ctx, 1);
  room.connect(gain(ctx, monkDry)).connect(out);
  const delay = ctx.createDelay(1);
  delay.delayTime.value = preDelaySecs;
  room.connect(delay).connect(gain(ctx, monkHallWet)).connect(hall(ctx)).connect(out);
  const sources: AudioScheduledSourceNode[] = [];
  const start = <T extends AudioScheduledSourceNode>(source: T) => {
    source.start();
    sources.push(source);
    return source;
  };
  /** Noise, slowly wandering, from a different place each time */
  const wander = (hz: number) => {
    const noise = ctx.createBufferSource();
    noise.buffer = getPinkNoise(ctx);
    noise.loop = true;
    noise.start(0, Math.random() * 0.9);
    sources.push(noise);
    return noise.connect(filter(ctx, "lowpass", hz));
  };

  // the voice, holding its note a little unsteadily
  const voice = start(osc(ctx, "sine", voiceHz));
  voice.setPeriodicWave(getThroat(ctx));
  wander(driftHz).connect(gain(ctx, driftCents)).connect(voice.detune);
  const vibrato = start(osc(ctx, "sine", vibratoHz));
  vibrato.connect(gain(ctx, voiceHz * vibratoDepth)).connect(voice.frequency);
  const throat = gain(ctx, 1);
  voice.connect(throat);
  wander(8000).connect(gain(ctx, breathiness)).connect(throat);
  const phrase = gain(ctx, phraseRest);
  phrase.connect(room);

  // the mouth, shaping "aa", "oo" and "mm" in turn
  const mouth = gain(ctx, formantLift);
  const bands = vowels.a.map(([hz, q, share]) => {
    const band = filter(ctx, "bandpass", hz, q);
    throat.connect(band).connect(gain(ctx, share)).connect(mouth);
    return band;
  });
  const lips = filter(ctx, "lowpass", lipsHz.a);
  mouth.connect(lips).connect(phrase);

  // overtones, a narrow resonance drifting over the voice, heard through closed lips too
  const overtone = filter(ctx, "bandpass", (overtoneHz[0] + overtoneHz[1]) / 2, overtoneQ);
  const drift = start(osc(ctx, "sine", overtoneDriftHz));
  drift.connect(gain(ctx, (overtoneHz[1] - overtoneHz[0]) / 2)).connect(overtone.frequency);
  throat.connect(overtone).connect(gain(ctx, overtoneShare)).connect(phrase);

  /** One "aum": a breath in, a scoop up onto the note, "aa" closing through "oo" to "mm", then easing for a breath */
  const sing = (at: number) => {
    const inhale = gain(ctx, 0);
    const breath = ctx.createBufferSource();
    breath.buffer = getPinkNoise(ctx);
    breath
      .connect(filter(ctx, "lowpass", 1200))
      .connect(inhale)
      .connect(phrase);
    inhale.gain.setTargetAtTime(inhaleLevel, at - inhaleSecs, inhaleSecs / 3);
    inhale.gain.setTargetAtTime(0, at, 0.1);
    breath.start(Math.max(ctx.currentTime, at - inhaleSecs), Math.random() * 0.3);
    breath.stop(at + 0.5);
    breath.onended = () => inhale.disconnect();
    voice.detune.setValueAtTime(-scoopCents, at);
    voice.detune.setTargetAtTime(0, at, scoopSecs);
    for (const [vowel, after, secs] of aum) {
      vowels[vowel].forEach(([hz], i) => bands[i].frequency.setTargetAtTime(hz, at + after, secs));
      lips.frequency.setTargetAtTime(lipsHz[vowel], at + after, secs);
    }
    phrase.gain.setTargetAtTime(1, at, 0.25);
    phrase.gain.setTargetAtTime(phraseRest, at + phraseSecs - breathSecs, 0.4);
  };
  const timers = { phrase: 0, bowl: 0 };
  const chant = (at: number) => {
    sing(at);
    const next = at + phraseSecs;
    timers.phrase = window.setTimeout(() => chant(next), (next - ctx.currentTime - 1) * 1000);
  };
  const ring = (at: number) => {
    strikeBowl(ctx, at, room);
    const next = at + bowlSecs * (0.8 + 0.4 * Math.random());
    timers.bowl = window.setTimeout(() => ring(next), (next - ctx.currentTime - 0.5) * 1000);
  };
  chant(ctx.currentTime + inhaleSecs);
  timers.bowl = window.setTimeout(() => ring(ctx.currentTime + 0.5), firstBowlSecs * 1000);

  const voiceOut = held(ctx, out, sources, monkLevel);
  return {
    set: voiceOut.set,
    stop(at) {
      window.clearTimeout(timers.phrase);
      window.clearTimeout(timers.bowl);
      voiceOut.stop(at);
    },
  };
}

const throats = new WeakMap<BaseAudioContext, Map<number, PeriodicWave>>();

/** A voice's source, as its folds pulse: each harmonic softer than the last, falling as a throat's do */
function getThroat(ctx: BaseAudioContext, tilt = throatTilt) {
  let byTilt = throats.get(ctx);
  if (byTilt === undefined) throats.set(ctx, (byTilt = new Map()));
  const cached = byTilt.get(tilt);
  if (cached !== undefined) return cached;
  const real = new Float32Array(throatHarmonics + 1);
  const imag = new Float32Array(throatHarmonics + 1);
  for (let n = 1; n <= throatHarmonics; n++) imag[n] = 1 / n ** tilt;
  const wave = ctx.createPeriodicWave(real, imag);
  byTilt.set(tilt, wave);
  return wave;
}

/**
 * A recorded chant, held whilst the player's psi is raised: `psi`'s `pick`th, else one at random, looped.
 * Each pass starts before the last ends, crossfaded, so it never seams.
 */
export function chantVoice(
  ctx: AudioContext,
  dest: AudioNode,
  { pick }: HoldParams,
  sample: (bank: SampleBank, pick?: number) => null | AudioBuffer,
): HeldVoice {
  const out = gain(ctx, 0);
  out.connect(dest);
  const buffer = sample("psi", pick);
  const sources: AudioScheduledSourceNode[] = [];
  let timer = 0;
  if (buffer !== null) {
    const secs = buffer.duration - 2 * chantSkipSecs;
    const rise = new Float32Array(curveSteps).map((_, i) => Math.sin(((i / (curveSteps - 1)) * Math.PI) / 2));
    const fall = rise.slice().reverse();
    const pass = (at: number) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const fade = gain(ctx, 0);
      fade.gain.setValueCurveAtTime(rise, at, chantCrossSecs);
      fade.gain.setValueCurveAtTime(fall, at + secs - chantCrossSecs, chantCrossSecs);
      source.connect(fade).connect(out);
      source.start(at, chantSkipSecs, secs);
      source.onended = () => {
        fade.disconnect();
        sources.splice(sources.indexOf(source), 1);
      };
      sources.push(source);
      const next = at + secs - chantCrossSecs;
      timer = window.setTimeout(() => pass(next), (next - ctx.currentTime - 0.5) * 1000);
    };
    pass(ctx.currentTime);
  }
  const voice = held(ctx, out, sources, chantLevel);
  return {
    set: voice.set,
    stop(at) {
      window.clearTimeout(timer);
      voice.stop(at);
    },
  };
}

/** Swells in as first held, and dies away once let go */
function held(ctx: AudioContext, out: GainNode, sources: AudioScheduledSourceNode[], level: number): HeldVoice {
  return {
    set({ level: by, gain: heard }, at) {
      out.gain.setTargetAtTime(heard * by * level * sfxLevel, at, fadeInSecs / 3);
    },
    stop(at) {
      out.gain.cancelScheduledValues(at);
      out.gain.setTargetAtTime(0, at, fadeOutSecs / 3);
      for (const source of sources) source.stop(at + fadeOutSecs + 0.2);
      window.setTimeout(() => out.disconnect(), (at - ctx.currentTime + fadeOutSecs + 0.3) * 1000);
    },
  };
}

/** The monk's note, D2 */
const voiceHz = 73.42;
/** The hall's share of the monk, and the monk's own, and how long before the hall answers */
const monkHallWet = 1.4;
const monkDry = 0.35;
const preDelaySecs = 0.04;
/** The hall's share of the choir, beside its own voices */
const choirHallWet = 1;
/** The choir's chord, in Hz: D2, A2, D3 */
const chordHz = [73.42, 110, 146.83];
/** The basses' note, D1, and how many sing it, and their share */
const bassHz = 36.71;
const bassSingers = 2;
const bassShare = 0.9;
/** How far across the room the choir's singers stand, `0` to `1` */
const spread = 0.6;
/** Each group's mouth, longer or shorter, and how much later it starts than the last */
const mouthScales = [0.93, 1, 1.07];
const staggerSecs = 0.18;
/** Cents each group is pitched apart */
const groupCents = 4;
/** Singers a note in each group, each a little out of tune with the rest */
const singers = 2;
const detuneCents = 10;
/** Harmonics in a voice's source, and how steeply each is softer than the last */
const throatHarmonics = 48;
const throatTilt = 1.7;
/** The choir's singers' own sources, brighter to darker */
const throatTilts = [1.9, 2.2, 2.5];
/** Cents each singer may stray from their place */
const detuneStray = 6;
/** How fast and how far, in cents, the voice's pitch wanders */
const driftHz = 0.5;
const driftCents = 12;
/** A phrase's scoop up onto the note: from how many cents under, and over how long */
const scoopCents = 40;
const scoopSecs = 0.12;
/** The breath in before a phrase: its length and level */
const inhaleSecs = 0.6;
const inhaleLevel = 0.05;
const vibratoHz = 4;
/** Vibrato's depth, a share of the note */
const vibratoDepth = 0.002;
type Vowel = "a" | "u" | "m";
/** The voice's formants for each vowel, as `[Hz, Q, share]`, the same three bands throughout */
const vowels: Record<Vowel, [number, number, number][]> = {
  a: [
    [550, 4, 1],
    [900, 6, 0.35],
    [2200, 8, 0.05],
  ],
  u: [
    [300, 4, 1],
    [650, 6, 0.35],
    [2000, 8, 0.05],
  ],
  m: [
    [200, 4, 1],
    [550, 6, 0.25],
    [1900, 8, 0.03],
  ],
};
/** How open the lips are on each vowel, as a lowpass */
const lipsHz: Record<Vowel, number> = { a: 800, u: 600, m: 280 };
/** One "aum", as `[vowel, seconds in, seconds to reach it]` */
const aum: [Vowel, number, number][] = [
  ["a", 0, 0.5],
  ["u", 5, 1],
  ["m", 9, 1],
];
/** The choir's chants, one a phrase: "aum", "om", a hum, and an open "aah" */
const chants: [Vowel, number, number][][] = [
  aum,
  [
    ["u", 0, 0.5],
    ["m", 7, 1],
  ],
  [["m", 0, 0.5]],
  [
    ["a", 0, 0.5],
    ["u", 11, 1.5],
  ],
];
/** The chant's mode, D Dorian, in cents from D: A, C, D, E, F, G, and A above */
const modeCents = [-500, -200, 0, 200, 300, 500, 700];
/** The mode's home, D */
const home = modeCents.indexOf(0);
/** How far into a phrase it steps to its second note, how long before its breath it falls to close, and the glide */
const stepShare = 0.45;
const closeSecs = 2;
const glideSecs = 0.25;

/** A step from `degree` of the mode: one or two up or down, drawn home the further it strays */
function walk(degree: number) {
  const pull = (home - degree) / modeCents.length;
  const by = (Math.random() < 0.7 ? 1 : 2) * (Math.random() < 0.5 + pull ? 1 : -1);
  return Math.max(0, Math.min(modeCents.length - 1, degree + by));
}
/** A phrase's length, the breath at its end, and its level whilst breathing */
const phraseSecs = 14;
const breathSecs = 1.8;
const phraseRest = 0.35;
/** The overtones' range in Hz, how narrow, how slowly they drift, and their share */
const overtoneHz = [600, 1100];
const overtoneQ = 30;
const overtoneDriftHz = 0.04;
const overtoneShare = 0.6;
/** A singing bowl: its note, D3, its partials as `[ratio, share, seconds ringing]`, and the beat of each */
const bowlHz = 146.83;
const bowlPartials: [number, number, number][] = [
  [1, 1, 12],
  [2.71, 0.5, 9],
  [5.15, 0.25, 6],
  [8.7, 0.1, 3.5],
];
const bowlBeatHz = 1.5;
const bowlLevel = 0.09;
/** Seconds between strikes, give or take a fifth, and before the first */
const bowlSecs = 20;
const firstBowlSecs = 3;
/** Lifts the narrow formants back to a level */
const formantLift = 4;
const breathiness = 0.15;
/** Seconds to swell in once raised, and to die away once lowered */
const fadeInSecs = 1.5;
const fadeOutSecs = 1;
/** The choir at full, and the monk, out of the world fader */
const choirLevel = 0.35;
const monkLevel = 0.5;
/** A recorded chant at full */
const chantLevel = 0.6;
/** Seconds skipped at each end of a chant, past an mp3's padding */
const chantSkipSecs = 0.08;
/** Seconds each pass of a chant crossfades into the next */
const chantCrossSecs = 1.5;
/** Points on a crossfade's curve */
const curveSteps = 64;
