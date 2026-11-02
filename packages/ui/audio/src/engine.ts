import { gain, limiter, room } from "./nodes";
import { loadSamples, pickSample, type SampleBank, type Samples, samplesKey } from "./samples";
import { type HeldVoice, type HoldKey, type HoldParams, holds, playSfx, type SfxKey, sfxSecs } from "./sfx";
import {
  type AudioConfig,
  audioChanges,
  audioConfigVersion,
  audioDefaults,
  createSteps,
  type Footfall,
  isStepSet,
  type StepSet,
  stepSetDefault,
  toAudioConfig,
} from "./steps";

export { type HoldKey, type HoldParams, holdKeys, isSfxKey, type SfxKey, sfxKeys } from "./sfx";
export {
  type AudioConfig,
  type AudioKey,
  audioChanges,
  audioConfigVersion,
  audioDefaults,
  audioRanges,
  audioUnits,
  type Footfall,
  isStepSet,
  type Side,
  type StepSet,
  stepSets,
} from "./steps";

export type AudioStatus = "stopped" | "playing" | "paused";
export type AudioMeterKey = keyof AudioEngine["meters"];
/** `pan` from `-1` (left) to `1` (right), and `amount` from `0` to `1`, e.g. a shot's charge */
export type SfxOpts = { pan?: number; gain?: number; amount?: number };

/** The page's one audio engine, made on first use — see `docs/audio.md` */
export function getAudio(): AudioEngine {
  return (shared.engine ??= createEngine());
}

/** Makes the engine on the next press or key, which lets it start, so its samples load before it is needed */
export function warmAudio() {
  if (shared.engine !== null) return;
  const make = () => {
    window.removeEventListener("pointerdown", make, true);
    window.removeEventListener("keydown", make, true);
    getAudio();
  };
  window.addEventListener("pointerdown", make, true);
  window.addEventListener("keydown", make, true);
}

function createEngine() {
  const ctx = (shared.ctx ??= new AudioContext());
  if (shared.samplesKey !== samplesKey) [shared.samples, shared.samplesKey] = [null, samplesKey];
  const samples = (shared.samples ??= loadSamples(ctx));
  const kept = shared.configVersion === audioConfigVersion ? shared.config : null;
  const config: AudioConfig = { ...audioDefaults, ...kept };
  const now = () => ctx.currentTime;

  const master = gain(ctx, config.master);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  master.connect(limiter(ctx)).connect(analyser).connect(ctx.destination);
  const steps = gain(ctx, config.steps);
  steps.connect(master);
  const fx = gain(ctx, config.fx);
  fx.connect(master);
  // the effects sit in a small room: the steps' recordings carry their own
  fx.connect(gain(ctx, roomWet)).connect(room(ctx)).connect(master);

  /** Which set of footsteps plays, chosen on the desk */
  let stepSet: StepSet = isStepSet(shared.stepSet) ? shared.stepSet : stepSetDefault;
  const player = createSteps(ctx, steps, samples, () => stepSet);

  /** A tap per channel, for the desk's level meters */
  const meter = (source: AudioNode) => {
    const node = ctx.createAnalyser();
    node.fftSize = 1024;
    source.connect(node);
    return node;
  };

  /** When a sound last played, by the page's clock: idle long enough, the context sleeps */
  let soundAt = performance.now();
  /** Whether the context has ever run, after which a press or key no longer wakes it */
  let started = ctx.state === "running";
  const resume = () => {
    soundAt = performance.now();
    if (ctx.state === "suspended") void ctx.resume().then(() => void (started = true));
  };
  /** Wakes the context on a press or key until it first runs, as browsers allow only then */
  const unlock = () => !started && resume();
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
  // asleep only once all is silent, and woken from silence, so neither pops
  const sleeper = window.setInterval(() => {
    if (ctx.state === "running" && performance.now() - soundAt > idleSecs * 1000) void ctx.suspend();
  }, sleepCheckMs);

  /** When each effect last played, and where, so a twin is dropped */
  const lastPlayed = new Map<SfxKey, { at: number; pan: number }>();
  /** Held voices by `key:id`, each kept until its lease, by the page's clock */
  const held = new Map<string, { voice: HeldVoice; params: null | HoldParams; until: number }>();
  let leaseTimer = 0;
  const releaseLapsed = () => {
    const lapsed = performance.now();
    for (const [id, entry] of held) {
      if (entry.until > lapsed) continue;
      entry.voice.stop(now());
      held.delete(id);
    }
    if (held.size > 0) return;
    window.clearInterval(leaseTimer);
    leaseTimer = 0;
  };
  /** A random ratio within `varyBy` of `1` */
  const vary = () => 1 + varyBy * (Math.random() * 2 - 1);

  const emit = () => {
    for (const listener of shared.listeners) listener();
  };

  const engine = {
    ctx,
    analyser,
    config,
    meters: { steps: meter(steps), fx: meter(fx), master: meter(analyser) },
    status: "stopped" as AudioStatus,
    /** One-shots still sounding, at most `maxVoices` */
    voices: 0,
    dispose() {
      for (const { voice } of held.values()) voice.stop(now());
      held.clear();
      window.clearInterval(leaseTimer);
      master.disconnect();
      window.clearInterval(sleeper);
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    },
    /** Holds `key`'s voice for `id`, e.g. an npcKey. Unless held again within `leaseMs`, it fades out */
    hold(key: HoldKey, id: string, params: HoldParams) {
      resume();
      const heldKey = `${key}:${id}`;
      let entry = held.get(heldKey);
      if (entry === undefined) held.set(heldKey, (entry = { voice: holds[key](ctx, fx), params: null, until: 0 }));
      // eased towards only on a change, so a param's timeline is not filled every tick
      if (entry.params === null || differs(entry.params, params)) {
        entry.voice.set(params, now());
        entry.params = params;
      }
      entry.until = performance.now() + leaseMs;
      leaseTimer ||= window.setInterval(releaseLapsed, leaseCheckMs);
    },
    pause() {
      if (engine.status !== "playing") return;
      engine.status = "paused";
      emit();
    },
    /** Plays from the top, else on from a pause */
    play() {
      if (engine.status === "playing") return;
      resume();
      engine.status = "playing";
      emit();
    },
    /** Known keys only, each kept within its range. The mix changes at once */
    set(partial: Partial<Record<string, unknown>>) {
      Object.assign(config, toAudioConfig(partial));
      const ease = (param: AudioParam, value: number) => param.setTargetAtTime(value, now(), 0.05);
      ease(master.gain, config.master);
      ease(steps.gain, config.steps);
      ease(fx.gain, config.fx);
      emit();
    },
    /** Fades out `key`'s voice for `id`, if held */
    release(key: HoldKey, id: string) {
      const entry = held.get(`${key}:${id}`);
      if (entry !== undefined) entry.until = 0;
      releaseLapsed();
    },
    /** Dropped if over budget, or the same effect just played at about the same place, as a hull door's twin */
    sfx(key: SfxKey, opts: SfxOpts = {}) {
      const [at, pan] = [now(), opts.pan ?? 0];
      const last = lastPlayed.get(key);
      if (last !== undefined && at - last.at < twinSecs && Math.abs(last.pan - pan) < twinPan) return;
      if (engine.voices >= maxVoices) return;
      lastPlayed.set(key, { at, pan });
      resume();
      engine.voices++;
      window.setTimeout(() => engine.voices--, sfxSecs * 1000);
      const level = (opts.gain ?? 1) * vary();
      const sample = (bank: SampleBank) => pickSample(samples, bank);
      playSfx(key, { ctx, out: fx, at, level, pan, amount: opts.amount ?? 1, pitch: vary(), sample });
    },
    /** One of the player's footfalls, heard at once whilst playing */
    footfall(footfall: Footfall) {
      if (engine.status !== "playing") return;
      resume();
      player.step(footfall);
    },
    /** Which set of footsteps plays */
    get stepSet() {
      return stepSet;
    },
    setStepSet(next: StepSet) {
      if (!isStepSet(next) || next === stepSet) return;
      stepSet = next;
      emit();
    },
    /** One step, whether playing or not, as the desk plays to hear one by */
    step(footfall: Footfall) {
      resume();
      player.step(footfall);
    },
    stop() {
      engine.status = "stopped";
      emit();
    },
    /** Called on every change of status, config or step set, never per frame */
    subscribe(listener: () => void) {
      shared.listeners.add(listener);
      return () => void shared.listeners.delete(listener);
    },
  };

  // stored before it plays, whose listeners may ask for it
  shared.engine = engine;
  if (shared.status === "playing") engine.play();
  return engine;
}

export type AudioEngine = ReturnType<typeof createEngine>;

type Shared = {
  ctx: null | AudioContext;
  engine: null | AudioEngine;
  samples: null | Samples;
  /** The sample files `samples` holds */
  samplesKey: string;
  listeners: Set<() => void>;
  /** Only what differs from `audioDefaults`, so a new default is taken up */
  config: null | Partial<AudioConfig>;
  configVersion: number;
  stepSet: null | StepSet;
  status: AudioStatus;
};

/** Seconds without a sound before the context sleeps, sparing the audio thread */
const idleSecs = 10;
const sleepCheckMs = 2000;
/** Whether held params changed enough to ease towards. Reaching either end of `level` always does */
const differs = (a: HoldParams, b: HoldParams) =>
  (a.level !== b.level && (b.level === 0 || b.level === 1)) ||
  Math.abs(a.level - b.level) + Math.abs(a.pan - b.pan) + Math.abs(a.gain - b.gain) > holdEpsilon;
const holdEpsilon = 0.01;
/** How long a held voice lasts unless held again, so one left behind, as by a paused World, fades out */
const leaseMs = 250;
const leaseCheckMs = 100;
/** The most one-shots sounding at once: more are dropped */
const maxVoices = 24;
/** The same effect again within this many seconds and this much pan is a twin, dropped */
const twinSecs = 0.06;
const twinPan = 0.1;
/** How far an effect's level and pitch stray, so no two alike */
const varyBy = 0.04;
/** The room's share of the effects */
const roomWet = 0.22;

const hot = import.meta.hot;
/** Kept across hot reloads, so a listener from an older module still finds the live engine */
const shared: Shared = hot?.data.shared ?? {
  ctx: null,
  engine: null,
  samples: null,
  samplesKey: "",
  listeners: new Set(),
  config: null,
  configVersion: 0,
  stepSet: null,
  // playing from the first, as footsteps should be
  status: "playing",
};
if (hot) hot.data.shared = shared;

// an engine already here was made by an older copy of this module, or of what it imports
if (shared.engine !== null) {
  const { engine } = shared;
  // one from before the footsteps carries settings that no longer apply
  const ours = "steps" in engine.config;
  const config = ours ? audioChanges(engine.config) : null;
  const stepSet = "stepSet" in engine ? engine.stepSet : null;
  Object.assign(shared, { config, configVersion: audioConfigVersion, stepSet, status: engine.status, engine: null });
  engine.dispose();
  getAudio(); // remade at once, so steps playing go on
}
