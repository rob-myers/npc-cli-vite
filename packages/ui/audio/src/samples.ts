import { loadBuffer } from "./nodes";

/** `count` files named `prefix0`, `prefix1`... */
const numbered = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i}`);

/** Each bank's files under `samplesUrl`: the footsteps on tile, then the sound effects' layers */
export const sampleFiles = {
  tile: numbered("steps/tile-", 10),
  tile3: numbered("steps/tile3-", 8),
  tile4: numbered("steps/tile4-", 8),
  armour: numbered("sfx/armour-", 5),
  slime: numbered("sfx/slime-", 1),
  grip: numbered("sfx/grip-", 4),
  cloth: numbered("sfx/cloth-", 4),
  click: numbered("sfx/click-", 2),
  thud: numbered("sfx/thud-", 1),
  boom: numbered("sfx/boom-", 2),
  lock: numbered("sfx/lock-", 1),
  clunk: numbered("sfx/clunk-", 7),
};

export type SampleBank = keyof typeof sampleFiles;
const sampleBanks = Object.keys(sampleFiles) as SampleBank[];

/** Filled in as they arrive, so each plays once it has */
export type Samples = Record<SampleBank, AudioBuffer[]> & {
  ready: Promise<void>;
  /** Each bank's last sample, never played twice running */
  last: Partial<Record<SampleBank, number>>;
};

/** Where the samples are served from — see its README for their sources */
const samplesUrl = "/audio/";
/** Changes with the files, so a hot reload fetches them again. Bump its version when they change in place */
export const samplesKey = JSON.stringify([samplesUrl, sampleFiles, 5]);

export function loadSamples(ctx: BaseAudioContext): Samples {
  const samples = { ready: Promise.resolve(), last: {} } as Samples;
  for (const bank of sampleBanks) samples[bank] = [];
  samples.ready = Promise.all(
    sampleBanks.map(async (bank) => {
      samples[bank] = await Promise.all(sampleFiles[bank].map((path) => loadBuffer(ctx, `${samplesUrl}${path}.mp3`)));
    }),
  )
    .then(() => {})
    .catch((e) => console.error("audio: samples failed to load", e));
  return samples;
}

/** A sample of `bank`, never the last one again, else `null` before they load */
export function pickSample(samples: Samples, bank: SampleBank) {
  const buffers = samples[bank];
  if (buffers.length === 0) return null;
  let i = Math.floor(Math.random() * buffers.length);
  if (i === samples.last[bank] && buffers.length > 1) i = (i + 1) % buffers.length;
  samples.last[bank] = i;
  return buffers[i];
}
