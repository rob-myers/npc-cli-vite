import { fetchBytes, loadBuffer } from "./nodes";

/** `count` files named `prefix0`, `prefix1`... */
const numbered = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i}`);

/** Each bank's files under `samplesUrl`: the footsteps on tile, then the sound effects' layers */
export const sampleFiles = {
  tile: numbered("steps/tile-", 10),
  tile3: numbered("steps/tile3-", 8),
  tile4: numbered("steps/tile4-", 8),
  armour: numbered("sfx/armour-", 5),
  grip: numbered("sfx/grip-", 4),
  cloth: numbered("sfx/cloth-", 4),
  click: numbered("sfx/click-", 2),
  thud: numbered("sfx/thud-", 1),
  lock: numbered("sfx/lock-", 1),
  clunk: numbered("sfx/clunk-", 7),
  book: numbered("sfx/book-", 3),
  zap: numbered("sfx/zap-", 6),
  shock: numbered("sfx/shock-", 3),
  static: numbered("sfx/static-", 1),
  spark: numbered("sfx/spark-", 2),
  psi: numbered("sfx/psi-", 4),
};

export type SampleBank = keyof typeof sampleFiles;
/** Banks fetched only once one of theirs is wanted, all together, then each decoded once wanted (`wantSample`) */
const lazyBanks: SampleBank[] = ["psi"];
const sampleBanks = (Object.keys(sampleFiles) as SampleBank[]).filter((bank) => !lazyBanks.includes(bank));

/** Filled in as they arrive, so each plays once it has. A lazy bank's are each missing until wanted */
export type Samples = Record<SampleBank, AudioBuffer[]> & {
  ready: Promise<void>;
  /** Each bank's last sample, never played twice running */
  last: Partial<Record<SampleBank, number>>;
  /** Each lazy sample's fetch, once wanted, by `bank:index` */
  loading: Record<string, Promise<void>>;
  /** Each lazy bank's files, fetched together, `null` if one failed */
  fetched: Partial<Record<SampleBank, Promise<null | ArrayBuffer>[]>>;
};

/** Where the samples are served from — see its README for their sources */
const samplesUrl = "/audio/";
/** Changes with the files, so a hot reload fetches them again. Bump its version when they change in place */
export const samplesKey = JSON.stringify([samplesUrl, sampleFiles, lazyBanks, 9]);

export function loadSamples(ctx: BaseAudioContext): Samples {
  const samples = { ready: Promise.resolve(), last: {}, loading: {}, fetched: {} } as Samples;
  for (const bank of sampleBanks) samples[bank] = [];
  for (const bank of lazyBanks) samples[bank] = new Array(sampleFiles[bank].length);
  samples.ready = Promise.all(sampleBanks.map((bank) => loadBank(ctx, samples, bank)))
    .then(() => {})
    .catch((e) => console.error("audio: samples failed to load", e));
  return samples;
}

async function loadBank(ctx: BaseAudioContext, samples: Samples, bank: SampleBank) {
  samples[bank] = await Promise.all(sampleFiles[bank].map((path) => loadBuffer(ctx, `${samplesUrl}${path}.mp3`)));
}

/**
 * Whether `bank`'s `index`th sample has loaded. A lazy bank's files are all fetched the first time any is
 * wanted, as fetching is the slow part. Each is decoded only once wanted, as decoded they are large
 */
export function wantSample(ctx: BaseAudioContext, samples: Samples, bank: SampleBank, index: number) {
  const buffers = samples[bank];
  if (buffers[index] !== undefined) return true;
  const files = (samples.fetched[bank] ??= sampleFiles[bank].map((path) =>
    fetchBytes(`${samplesUrl}${path}.mp3`).catch((e) => {
      console.error(`audio: ${path} failed to fetch`, e);
      return null;
    }),
  ));
  samples.loading[`${bank}:${index}`] ??= files[index]
    .then((bytes) => (bytes === null ? null : ctx.decodeAudioData(bytes)))
    .then((buffer) => void (buffer !== null && (buffers[index] = buffer)))
    .catch((e) => console.error(`audio: ${bank} ${index} failed to decode`, e));
  return false;
}

/** How many samples `bank` has, loaded or not */
export const bankSize = (bank: SampleBank) => sampleFiles[bank].length;

/** A sample of `bank`: its `pick`th, else one never the last again. `null` before they load */
export function pickSample(samples: Samples, bank: SampleBank, pick?: number) {
  const buffers = samples[bank];
  if (buffers.length === 0) return null;
  if (pick !== undefined) return buffers[pick % buffers.length] ?? null;
  let i = Math.floor(Math.random() * buffers.length);
  if (i === samples.last[bank] && buffers.length > 1) i = (i + 1) % buffers.length;
  samples.last[bank] = i;
  return buffers[i] ?? null;
}
