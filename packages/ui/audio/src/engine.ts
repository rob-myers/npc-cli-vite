import { gain, limiter } from "./nodes";
import { playSfx, type SfxKey } from "./sfx";
import {
  type AudioConfig,
  audioChanges,
  audioConfigVersion,
  audioDefaults,
  createSteps,
  type Footfall,
  isStepSet,
  loadSamples,
  type Samples,
  type StepSet,
  samplesKey,
  stepSetDefault,
  toAudioConfig,
} from "./steps";

export { isSfxKey, type SfxKey, sfxKeys } from "./sfx";
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
/** `pan` from `-1` (left) to `1` (right) */
export type SfxOpts = { pan?: number; gain?: number };

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
  const emit = () => {
    for (const listener of shared.listeners) listener();
  };

  const engine = {
    ctx,
    analyser,
    config,
    meters: { steps: meter(steps), fx: meter(fx), master: meter(analyser) },
    status: "stopped" as AudioStatus,
    dispose() {
      master.disconnect();
      window.clearInterval(sleeper);
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
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
    sfx(key: SfxKey, opts: SfxOpts = {}) {
      resume();
      playSfx(key, { ctx, out: fx, at: now(), level: opts.gain ?? 1, pan: opts.pan ?? 0 });
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
