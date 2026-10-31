import { gain, loadBuffer, panner } from "./nodes";

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

/** `count` files named `prefix0`, `prefix1`... */
const numbered = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i}`);

/** Each set of footsteps' files, under `samplesUrl`: all on tile. The player's is chosen on the desk */
const stepFiles = {
  tile: numbered("steps/tile-", 10),
  tile3: numbered("steps/tile3-", 8),
  tile4: numbered("steps/tile4-", 8),
};

export type StepSet = keyof typeof stepFiles;
export const stepSets = Object.keys(stepFiles) as StepSet[];
export const isStepSet = (key: unknown): key is StepSet => typeof key === "string" && key in stepFiles;
export const stepSetDefault: StepSet = "tile4";

/** Filled in as they arrive, so steps play once they have */
export type Samples = Record<StepSet, AudioBuffer[]> & { ready: Promise<void> };

/** Where the samples are served from — see its README for their sources */
const samplesUrl = "/audio/";
/** Changes with the files, so a hot reload fetches them again. Bump its version when they change in place */
export const samplesKey = JSON.stringify([samplesUrl, stepFiles, 3]);

export function loadSamples(ctx: BaseAudioContext): Samples {
  const samples = { ready: Promise.resolve() } as Samples;
  for (const set of stepSets) samples[set] = [];
  samples.ready = Promise.all(
    stepSets.map(async (set) => {
      samples[set] = await Promise.all(stepFiles[set].map((path) => loadBuffer(ctx, `${samplesUrl}${path}.mp3`)));
    }),
  )
    .then(() => {})
    .catch((e) => console.error("audio: footsteps failed to load", e));
  return samples;
}

export type Side = "left" | "right";

/**
 * A footfall as jsh reads it: its foot, whether running, how hard (`0` to `1`), where across the view,
 * and its set of footsteps, else the player's
 */
export type Footfall = { side: Side; run: boolean; level: number; pan?: number; set?: StepSet };

/** Footsteps, one per footfall, from the set `set()` names */
export function createSteps(ctx: AudioContext, out: AudioNode, samples: Samples, set: () => StepSet) {
  /** Each set's last sample, never played twice running */
  const last = {} as Record<StepSet, number>;

  return {
    /** A footfall, now, as recorded */
    step({ side, level, pan = 0, set: own }: Footfall) {
      const key = own !== undefined && isStepSet(own) ? own : set();
      const steps = samples[key];
      if (steps.length === 0 || level <= 0) return;
      let i = Math.floor(Math.random() * steps.length);
      if (i === last[key] && steps.length > 1) i = (i + 1) % steps.length;
      last[key] = i;
      const at = ctx.currentTime;
      const source = ctx.createBufferSource();
      source.buffer = steps[i];
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
