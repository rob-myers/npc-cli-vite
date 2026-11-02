import { gain, panner } from "./nodes";
import { pickSample, type SampleBank, type Samples } from "./samples";

/** The desk's settings: the footsteps, the sound effects and the mix */
export const audioDefaults = {
  master: 0.7,
  steps: 0.8,
  fx: 0.8,
};

export type AudioConfig = typeof audioDefaults;
export type AudioKey = keyof AudioConfig;

/** Each control's `[min, max, step]` */
export const audioRanges: Record<AudioKey, [number, number, number]> = {
  master: [0, 1, 0.01],
  steps: [0, 1, 0.01],
  fx: [0, 1, 0.01],
};

export const audioUnits: Partial<Record<AudioKey, string>> = {};

/** Marks a saved config. Bumped when the defaults change, so a desk saved against older ones starts afresh */
export const audioConfigVersion = 7;

/** Only the settings of `config` that differ from `audioDefaults`, which is what a desk saves */
export function audioChanges(config: AudioConfig) {
  const changes: Partial<AudioConfig> = {};
  for (const key of Object.keys(audioDefaults) as AudioKey[]) {
    if (config[key] !== audioDefaults[key]) changes[key] = config[key];
  }
  return changes;
}

/** Only the known keys of `partial`, each a number within its range */
export function toAudioConfig(partial: Partial<Record<string, unknown>> = {}) {
  const config: Partial<AudioConfig> = {};
  for (const [key, value] of Object.entries(partial)) {
    if (!(key in audioRanges) || typeof value !== "number" || !Number.isFinite(value)) continue;
    const [min, max] = audioRanges[key as AudioKey];
    config[key as AudioKey] = Math.min(max, Math.max(min, value));
  }
  return config;
}

/** The sets of footsteps, each a bank of samples: all on tile. The player's is chosen on the desk */
export const stepSets = ["tile", "tile3", "tile4"] as const satisfies SampleBank[];
export type StepSet = (typeof stepSets)[number];
export const isStepSet = (key: unknown): key is StepSet => stepSets.includes(key as StepSet);
export const stepSetDefault: StepSet = "tile4";

export type Side = "left" | "right";

/**
 * A footfall as jsh reads it: its foot, whether running, how hard (`0` to `1`), where across the view,
 * and its set of footsteps, else the player's
 */
export type Footfall = { side: Side; run: boolean; level: number; pan?: number; set?: StepSet };

/** Footsteps, one per footfall, from the set `set()` names */
export function createSteps(ctx: AudioContext, out: AudioNode, samples: Samples, set: () => StepSet) {
  return {
    /** A footfall, now, as recorded */
    step({ side, level, pan = 0, set: own }: Footfall) {
      const key = own !== undefined && isStepSet(own) ? own : set();
      const buffer = level > 0 ? pickSample(samples, key) : null;
      if (buffer === null) return;
      const at = ctx.currentTime;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      // no two alike: a little louder or softer
      const amp = gain(ctx, level * stepLevel * (0.85 + Math.random() * 0.3));
      const place = panner(ctx, pan + (side === "left" ? -sidePan : sidePan));
      source.connect(amp).connect(place).connect(out);
      source.start(at);
      source.onended = () => {
        amp.disconnect();
        place.disconnect();
      };
    },
  };
}

/** How far each foot is placed to its side */
const sidePan = 0.12;
/** A step's level at full gait and fader */
const stepLevel = 1;
