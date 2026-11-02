import { filter, gain, getPinkNoise, hall, osc, panner } from "./nodes";
import type { SampleBank } from "./samples";
import type { HeldVoice, HoldParams } from "./sfx";
import { sfxLevel } from "./synth";

/** What sings whilst psi is raised, chosen on the desk: the choir, a chant (`psi`'s, in order), else either */
export const psiVoices = ["random", "choir", "low-d", "low-chant", "drone", "eerie"] as const;
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
  room.connect(gain(ctx, hallWet)).connect(hall(ctx)).connect(out);
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

  const groups = mouthScales.map((scale, g) => {
    // the singers of this group, each holding their note a little unsteadily
    const voices = gain(ctx, 1 / (chordHz.length * singers));
    const singing = chordHz.flatMap((hz) =>
      Array.from({ length: singers }, (_, i) => {
        const singer = start(osc(ctx, "sine", hz));
        singer.setPeriodicWave(throat);
        const detune = (i - (singers - 1) / 2) * detuneCents + g * groupCents;
        singer.detune.value = detune;
        wander(driftHz).connect(gain(ctx, driftCents)).connect(singer.detune);
        const vibrato = start(osc(ctx, "sine", vibratoHz * (0.9 + 0.2 * Math.random())));
        vibrato.connect(gain(ctx, hz * vibratoDepth)).connect(singer.frequency);
        singer.connect(panner(ctx, spread * (Math.random() * 2 - 1))).connect(voices);
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
  for (let i = 0; i < bassSingers; i++) {
    const bass = start(osc(ctx, "sine", bassHz));
    bass.setPeriodicWave(throat);
    bass.detune.value = (i - (bassSingers - 1) / 2) * detuneCents;
    wander(driftHz).connect(gain(ctx, driftCents)).connect(bass.detune);
    bass.connect(basses);
  }

  /**
   * One "aum", each group a little after the last: a breath in, a scoop up onto the note, "aa" closing through
   * "oo" to "mm", then easing for a breath
   */
  const sing = (at: number) => {
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
        singer.detune.setValueAtTime(detune - scoopCents, from);
        singer.detune.setTargetAtTime(detune, from, scoopSecs);
      }
      for (const [vowel, after, secs] of aum) {
        vowels[vowel].forEach(([hz], i) => bands[i].frequency.setTargetAtTime(hz * scale, from + after, secs));
        lips.frequency.setTargetAtTime(lipsHz[vowel] * scale, from + after, secs);
      }
      phrase.gain.setTargetAtTime(1, from, 0.25);
      phrase.gain.setTargetAtTime(phraseRest, from + phraseSecs - breathSecs, 0.4);
    }
  };
  /** A singing bowl struck: its partials, each a pair beating, ringing out */
  const strike = (at: number) => {
    for (const [ratio, share, ring] of bowlPartials) {
      for (const beat of [0, bowlBeatHz]) {
        const tone = osc(ctx, "sine", bowlHz * ratio + beat);
        const fade = gain(ctx, 0);
        fade.gain.setValueAtTime(0, at);
        fade.gain.linearRampToValueAtTime((bowlLevel * share) / 2, at + 0.01);
        fade.gain.setTargetAtTime(0, at + 0.01, ring / 4);
        tone.connect(fade).connect(room);
        tone.start(at);
        tone.stop(at + ring);
        tone.onended = () => fade.disconnect();
      }
    }
  };

  const timers = { phrase: 0, bowl: 0 };
  const chant = (at: number) => {
    sing(at);
    const next = at + phraseSecs;
    timers.phrase = window.setTimeout(() => chant(next), (next - ctx.currentTime - 1) * 1000);
  };
  const ring = (at: number) => {
    strike(at);
    const next = at + bowlSecs * (0.8 + 0.4 * Math.random());
    timers.bowl = window.setTimeout(() => ring(next), (next - ctx.currentTime - 0.5) * 1000);
  };
  chant(ctx.currentTime + inhaleSecs);
  timers.bowl = window.setTimeout(() => ring(ctx.currentTime + 0.5), firstBowlSecs * 1000);

  const voice = held(ctx, out, sources, choirLevel);
  return {
    set: voice.set,
    stop(at) {
      window.clearTimeout(timers.phrase);
      window.clearTimeout(timers.bowl);
      voice.stop(at);
    },
  };
}

const throats = new WeakMap<BaseAudioContext, PeriodicWave>();

/** A voice's source, as its folds pulse: each harmonic softer than the last, falling as a throat's do */
function getThroat(ctx: BaseAudioContext) {
  const cached = throats.get(ctx);
  if (cached !== undefined) return cached;
  const real = new Float32Array(throatHarmonics + 1);
  const imag = new Float32Array(throatHarmonics + 1);
  for (let n = 1; n <= throatHarmonics; n++) imag[n] = 1 / n ** throatTilt;
  const wave = ctx.createPeriodicWave(real, imag);
  throats.set(ctx, wave);
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

/** The chord, in Hz: D2, A2, D3 */
const chordHz = [73.42, 110, 146.83];
/** The basses' note, D1, and how many sing it, and their share */
const bassHz = 36.71;
const bassSingers = 2;
const bassShare = 0.9;
/** How far across the room the singers stand, `0` to `1` */
const spread = 0.6;
/** The hall's share of the choir */
const hallWet = 0.8;
/** Harmonics in a voice's source, and how steeply each is softer than the last */
const throatHarmonics = 48;
const throatTilt = 1.7;
/** Each group's mouth, longer or shorter, and how much later it starts than the last */
const mouthScales = [0.93, 1, 1.07];
const staggerSecs = 0.18;
/** Cents each group is pitched apart */
const groupCents = 4;
/** How fast and how far, in cents, a singer's pitch wanders */
const driftHz = 0.5;
const driftCents = 12;
/** A phrase's scoop up onto the note: from how many cents under, and over how long */
const scoopCents = 40;
const scoopSecs = 0.12;
/** The breath in before a phrase: its length and level */
const inhaleSecs = 0.6;
const inhaleLevel = 0.05;
/** Singers a note in each group, each a little out of tune with the rest */
const singers = 2;
const detuneCents = 10;
const vibratoHz = 4;
/** Vibrato's depth, a share of the note */
const vibratoDepth = 0.002;
type Vowel = "a" | "u" | "m";
/** The voices' formants for each vowel, as `[Hz, Q, share]`, the same three bands throughout */
const vowels: Record<Vowel, [number, number, number][]> = {
  a: [
    [600, 4, 1],
    [1000, 6, 0.4],
    [2300, 8, 0.08],
  ],
  u: [
    [320, 4, 1],
    [700, 6, 0.4],
    [2100, 8, 0.08],
  ],
  m: [
    [220, 4, 1],
    [600, 6, 0.3],
    [2000, 8, 0.05],
  ],
};
/** How open their lips are on each vowel, as a lowpass */
const lipsHz: Record<Vowel, number> = { a: 1000, u: 700, m: 320 };
/** One "aum", as `[vowel, seconds in, seconds to reach it]` */
const aum: [Vowel, number, number][] = [
  ["a", 0, 0.5],
  ["u", 5, 1],
  ["m", 9, 1],
];
/** A phrase's length, the breath at its end, and its level whilst breathing */
const phraseSecs = 14;
const breathSecs = 1.8;
const phraseRest = 0.35;
/** The overtones' range in Hz, how narrow, how slowly they drift, and their share */
const overtoneHz = [600, 1100];
const overtoneQ = 30;
const overtoneDriftHz = 0.04;
const overtoneShare = 1;
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
/** The choir at full, out of the world fader */
const choirLevel = 0.35;
/** A recorded chant at full */
const chantLevel = 0.6;
/** Seconds skipped at each end of a chant, past an mp3's padding */
const chantSkipSecs = 0.08;
/** Seconds each pass of a chant crossfades into the next */
const chantCrossSecs = 1.5;
/** Points on a crossfade's curve */
const curveSteps = 64;
