import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, useStateRef } from "@npc-cli/util";
import {
  ArrowCounterClockwiseIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CopyIcon,
  FlowArrowIcon,
  PauseIcon,
  PlayIcon,
  QuestionIcon,
  SlidersHorizontalIcon,
  StopIcon,
  WaveformIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useContext, useEffect, useRef } from "react";
import {
  type AudioKey,
  type AudioMeterKey,
  audioChanges,
  audioConfigVersion,
  audioDefaults,
  audioRanges,
  audioUnits,
  getAudio,
  isStepSet,
  type SfxKey,
  type Side,
  sfxKeys,
  stepSets,
} from "./engine";
import { graphColours } from "./graph-data";
import { type HelpStep, type HelpWhen, help, helpIntro } from "./help";
import { Graph } from "./NodeGraph";
import type { AudioUiMeta } from "./schema";

/** Plays the player's footsteps and the weapon sounds, tuned by ear on a mixing desk: a strip per channel */
export default function Audio({ meta }: { meta: AudioUiMeta }) {
  const { uiStoreApi } = useContext(UiContext);

  const state = useStateRef(
    (): State => ({
      canvas: null,
      bins: new Uint8Array(2048),
      frameId: 0,
      live: false,
      help: null,
      rootEl: null,
      stepSide: "left",
      levels: { steps: 0, fx: 0, master: 0 },
      meterEls: { steps: null, fx: null, master: null },
      wave: new Float32Array(1024),

      draw() {
        if (!state.live) return;
        state.frameId = requestAnimationFrame(state.draw);
        // nothing read or drawn whilst the desk is out of sight, as its tab hidden
        if (state.rootEl?.checkVisibility() !== true) return;
        const audio = getAudio();
        for (const key of meterKeys) {
          audio.meters[key].getFloatTimeDomainData(state.wave);
          let peak = 0;
          for (const sample of state.wave) peak = Math.max(peak, Math.abs(sample));
          const level = Math.min(1, Math.max(0, 1 + (20 * Math.log10(peak || 1e-6)) / meterFloorDb));
          state.setMeter(key, Math.max(level, state.levels[key] - meterFall));
        }

        const { canvas } = state;
        const g = canvas?.getContext("2d");
        if (!canvas || !g) return;
        const { bins } = state;
        audio.analyser.getByteFrequencyData(bins);
        const { width, height } = canvas;
        g.clearRect(0, 0, width, height);
        g.fillStyle = "#4ade80";
        const hzPerBin = audio.ctx.sampleRate / audio.analyser.fftSize;
        for (let x = 0; x < width; x += 3) {
          const hz = spectrumHz[0] * (spectrumHz[1] / spectrumHz[0]) ** (x / width);
          const level = bins[Math.min(bins.length - 1, Math.round(hz / hzPerBin))] / 255;
          g.fillRect(x, height * (1 - level), 2, height * level);
        }
      },
      onChange() {
        const config = audioChanges(getAudio().config);
        const { stepSet } = getAudio();
        uiStoreApi.setUiMeta(meta.id, (draft) => {
          Object.assign(draft as AudioUiMeta, { config, configVersion: audioConfigVersion, stepSet });
        });
        state.update();
      },
      onKeyDown(e) {
        if (e.key === "Escape") return state.setHelp(null);
        const key = (e.target as HTMLElement).closest<HTMLElement>("[data-help]")?.dataset.help as AudioKey;
        if (e.key !== "Enter" || key === undefined) return;
        e.preventDefault();
        state.help === null ? state.setHelp(key) : state.stepHelp(e.shiftKey ? -1 : 1);
      },
      playStep(run) {
        state.stepSide = state.stepSide === "left" ? "right" : "left";
        getAudio().step({ side: state.stepSide, run, level: run ? 1 : 0.7 });
      },
      setDisabled(disabled) {
        uiStoreApi.setUiMeta(meta.id, (draft) => void (draft.disabled = disabled));
      },
      setHelp(step) {
        state.set({ help: step });
        const el = step === null ? null : state.rootEl?.querySelector(`[data-help="${step}"]`);
        el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        // focused, so the arrow keys turn it at once
        el?.querySelector<HTMLElement>('[role="slider"]')?.focus({ preventScroll: true });
      },
      setMeter(key, level) {
        state.levels[key] = level;
        const el = state.meterEls[key];
        if (el) el.style.height = `${(1 - level) * 100}%`;
      },
      setPaused(paused) {
        const audio = getAudio();
        paused ? audio.pause() : audio.play();
        state.setDisabled(paused);
      },
      stepHelp(by) {
        const at = state.help === null ? 0 : tour.indexOf(state.help) + by;
        state.setHelp(tour[(at + tour.length) % tour.length]);
      },
      toggleLive() {
        state.live = !state.live;
        cancelAnimationFrame(state.frameId);
        if (state.live) state.draw();
        else {
          for (const key of meterKeys) state.setMeter(key, 0);
          const { canvas } = state;
          canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
        }
        state.update();
      },
      togglePlay() {
        const audio = getAudio();
        if (audio.status === "playing") return audio.stop();
        audio.play();
        state.setDisabled(false);
      },
    }),
    { deps: [uiStoreApi] },
  );

  // remade on an edit of the engine, which keeps its status
  useEffect(() => {
    const audio = getAudio();
    if (meta.config !== undefined && meta.configVersion === audioConfigVersion) audio.set(meta.config);
    if (isStepSet(meta.stepSet)) audio.setStepSet(meta.stepSet);
    const unsubscribe = audio.subscribe(state.onChange);
    if (state.live) state.draw();
    return () => {
      unsubscribe();
      cancelAnimationFrame(state.frameId);
    };
  }, [getAudio]);

  // its tab's button pauses it too, so only a change acts: a mount leaves the steps be
  const wasDisabled = useRef(meta.disabled);
  useEffect(() => {
    if (wasDisabled.current === meta.disabled) return;
    wasDisabled.current = meta.disabled;
    const audio = getAudio();
    if (meta.disabled === true) audio.pause();
    else if (audio.status === "paused") audio.play();
  }, [meta.disabled]);

  const audio = getAudio();
  const { config } = audio;
  const playing = audio.status !== "stopped";
  const paused = audio.status === "paused";
  const view = meta.view ?? "desk";
  const setView = (next: AudioUiMeta["view"]) => {
    state.setHelp(null);
    uiStoreApi.setUiMeta(meta.id, (draft) => void ((draft as AudioUiMeta).view = next));
  };
  const setConfig = (partial: Partial<Record<AudioKey, number>>) => audio.set(partial);
  const playButton = (className: string) => (
    <button type="button" title={playing ? "stop" : "play"} className={className} onClick={state.togglePlay}>
      {playing ? <StopIcon className="size-4" weight="fill" /> : <PlayIcon className="size-4" weight="fill" />}
    </button>
  );
  const pauseButton = (baseClass: string, pausedClass: string) => (
    <button
      type="button"
      title={paused ? "resume" : "pause"}
      disabled={!playing}
      className={cn(baseClass, "disabled:cursor-default disabled:opacity-40", paused && pausedClass)}
      onClick={() => state.setPaused(!paused)}
    >
      <PauseIcon className="size-4" weight="fill" />
    </button>
  );
  /** Touring, the control explained stands out and pressing another moves the tour to it */
  const helped = (key: AudioKey) => ({
    "data-help": key,
    className: cn(
      "rounded transition-opacity",
      state.help !== null && (state.help === key ? "bg-white/10 ring-2 ring-white/70" : "opacity-40"),
    ),
    onFocusCapture: () => state.help !== null && state.help !== key && state.setHelp(key),
  });
  const fader = (key: AudioKey & AudioMeterKey, colour: string, heightClass = faderClass) => (
    <div className={cn("mt-auto flex justify-center gap-3 px-2 pt-3 [@container_(height<40rem)]:pt-1.5", heightClass)}>
      <div
        className="relative w-2.5 overflow-hidden rounded-sm bg-black ring-1 ring-black"
        style={{ backgroundImage: meterGradient }}
      >
        <div
          ref={(el) => void (state.meterEls[key] = el)}
          className="absolute inset-x-0 top-0 bg-zinc-950/95"
          style={{ height: `${(1 - state.levels[key]) * 100}%` }}
        />
        <div className="absolute inset-0" style={{ backgroundImage: meterSegments }} />
      </div>
      <div {...helped(key)} className={cn(helped(key).className, "flex")}>
        <Fader k={key} value={config[key]} colour={colour} onChange={(v) => setConfig({ [key]: v })} />
      </div>
    </div>
  );

  return (
    <div
      ref={state.ref("rootEl")}
      className="relative size-full bg-[#0c0d0f] text-zinc-300 select-none"
      onKeyDown={state.onKeyDown}
    >
      <div className="absolute top-2 left-2 z-10 flex gap-1">
        <button
          type="button"
          title="the mixing desk"
          className={cn(viewButtonClass, view === "desk" && "bg-zinc-600 text-white")}
          onClick={() => setView("desk")}
        >
          <SlidersHorizontalIcon className="size-4" />
        </button>
        <button
          type="button"
          title="how the nodes are connected"
          className={cn(viewButtonClass, view === "graph" && "bg-zinc-600 text-white")}
          onClick={() => setView("graph")}
        >
          <FlowArrowIcon className="size-4" />
        </button>
        {view === "graph" && playButton(cn(viewButtonClass, playing && "text-emerald-300"))}
        {view === "graph" && pauseButton(viewButtonClass, "text-amber-300")}
      </div>

      {view === "graph" && (
        <div className="flex size-full overflow-auto scrollbar-thin p-3 pt-11">
          <Graph config={config} playing={playing && !paused} />
        </div>
      )}

      {/* hidden, not unmounted, so its meters and screen keep their elements */}
      <div
        className={cn(
          "[container-type:size] flex size-full overflow-auto scrollbar-thin p-3 pt-11 [@container_(height<40rem)]:pb-1",
          state.help !== null && "pb-48",
          view === "graph" && "hidden",
        )}
      >
        <div
          className="m-auto flex @min-lg:h-full @min-lg:max-h-[42rem] min-h-fit max-w-full flex-wrap justify-center gap-1.5 @max-lg:w-full rounded-lg border border-black bg-[#1b1d21] p-2 [@container_(height<40rem)]:p-1 shadow-[inset_0_1px_0_#ffffff14,0_8px_24px_#000a]"
          style={{ backgroundImage: deskTexture }}
        >
          <Strip title="steps" colour={stepsColour} className="@max-lg:grow">
            <div className="grid grid-cols-[3.5rem] justify-center gap-1.5 px-2 pt-2">
              {stepSets.map((set) => (
                <button
                  key={set}
                  type="button"
                  title={`${set}: play a step and use these footsteps, shift for a running one`}
                  className={cn(
                    buttonClass,
                    "h-7 w-full text-[9px] tracking-wider uppercase",
                    audio.stepSet === set && "text-amber-300 shadow-[0_0_8px_#f59e0b66]",
                  )}
                  onClick={(e) => {
                    audio.setStepSet(set);
                    state.playStep(e.shiftKey);
                  }}
                >
                  {set}
                </button>
              ))}
            </div>
            {fader("steps", stepsColour)}
            <Readout value={config.steps} colour={stepsColour} />
          </Strip>

          <Strip title="fx" colour={fxColour} className="@max-lg:grow">
            <div className="grid grid-cols-[3.5rem] justify-center gap-1.5 px-2 pt-2">
              {sfxKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  title={`play ${key}`}
                  className={cn(buttonClass, "h-7 w-full text-[9px] tracking-wider uppercase")}
                  onClick={() => audio.sfx(key)}
                >
                  {sfxLabels[key]}
                </button>
              ))}
            </div>
            {fader("fx", fxColour)}
            <Readout value={config.fx} colour={fxColour} />
          </Strip>

          {/* too narrow for another strip, it lies along the foot of the desk */}
          <Strip title="master" colour={masterColour} className="@max-lg:basis-full">
            <div className="flex flex-1 flex-col @max-lg:flex-row @max-lg:items-center @max-lg:justify-center @max-lg:gap-2">
              <div className="flex flex-col items-center gap-2.5 px-2 pt-2">
                <canvas
                  ref={state.ref("canvas")}
                  width={132}
                  height={56}
                  className="h-14 w-33 @min-lg:@max-xl:w-17 rounded-sm border border-black bg-[#07140c] shadow-[inset_0_0_8px_#000]"
                />

                <div className="grid grid-cols-3 gap-1 @min-lg:@max-xl:grid-cols-2">
                  {playButton(cn(buttonClass, playing && "text-emerald-300 shadow-[0_0_8px_#34d39966]"))}
                  {pauseButton(buttonClass, "text-amber-300 shadow-[0_0_8px_#fbbf2466]")}
                  <button
                    type="button"
                    title="reset to defaults"
                    className={buttonClass}
                    onClick={() => setConfig(audioDefaults)}
                  >
                    <ArrowCounterClockwiseIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    title="copy config"
                    className={buttonClass}
                    onClick={() => void navigator.clipboard.writeText(JSON.stringify(config, null, 2))}
                  >
                    <CopyIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    title={state.live ? "stop the live meters" : "live meters and spectrum, redrawn each frame"}
                    className={cn(buttonClass, state.live && "text-emerald-300 shadow-[0_0_8px_#34d39966]")}
                    onClick={state.toggleLive}
                  >
                    <WaveformIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    title="what each control does"
                    className={cn(buttonClass, state.help !== null && "text-white shadow-[0_0_8px_#ffffff55]")}
                    onClick={() => state.setHelp(state.help === null ? "intro" : null)}
                  >
                    <QuestionIcon className="size-4" weight="bold" />
                  </button>
                </div>
              </div>
              <div className="flex flex-1 flex-col @max-lg:flex-none">
                {fader("master", masterColour, cn(faderClass, "@max-lg:basis-28 @max-lg:flex-none"))}
                <Readout value={config.master} colour={masterColour} />
              </div>
            </div>
          </Strip>
        </div>
      </div>

      {state.help !== null && (
        <HelpCard
          step={state.help}
          value={state.help === "intro" ? null : config[state.help]}
          onStep={state.stepHelp}
          onClose={() => state.setHelp(null)}
        />
      )}
    </div>
  );
}

/** The tour's caption, along the foot of the pane so it covers no strip's controls */
function HelpCard(props: { step: HelpStep; value: null | number; onStep(by: number): void; onClose(): void }) {
  const { step } = props;
  const entry = step === "intro" ? null : help[step];
  const { title, text } = entry ?? helpIntro;

  return (
    <div className="absolute inset-x-3 bottom-3 mx-auto max-w-xl rounded-md border border-zinc-600 bg-zinc-900/95 p-3 text-xs select-text shadow-[0_8px_24px_#000c]">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-zinc-100">{title}</span>
        {step !== "intro" && <span className="font-mono text-[10px] text-zinc-500">{step}</span>}
        {entry && (
          <span
            className={cn(
              "rounded-sm px-1 py-px text-[9px] tracking-wider uppercase",
              entry.when === "now" ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-300",
            )}
          >
            {whenLabels[entry.when]}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-col gap-1 leading-snug text-zinc-300">
        {text.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      {step !== "intro" && (
        <div className="mt-2 font-mono text-[10px] tabular-nums text-zinc-500">
          now {props.value}
          {audioUnits[step]} · range {audioRanges[step][0]} to {audioRanges[step][1]}
          {audioUnits[step]} · default {audioDefaults[step]}
          {audioUnits[step]}
        </div>
      )}
      {/* the card grows upwards, so only its foot stays put under the pointer */}
      <div className="mt-2 flex items-end gap-2">
        <span className="flex-1 text-[10px] text-zinc-500">
          tab: another control · up/down: turn it · enter: next · shift+enter: previous · esc: close
        </span>
        <span className="w-12 shrink-0 text-right tabular-nums text-zinc-500">
          {tour.indexOf(step) + 1} / {tour.length}
        </span>
        <button type="button" title="previous" className={helpButtonClass} onClick={() => props.onStep(-1)}>
          <CaretLeftIcon className="size-3.5" weight="bold" />
        </button>
        <button type="button" title="next" className={helpButtonClass} onClick={() => props.onStep(1)}>
          <CaretRightIcon className="size-3.5" weight="bold" />
        </button>
        <button type="button" title="close" className={helpButtonClass} onClick={props.onClose}>
          <XIcon className="size-3.5" weight="bold" />
        </button>
      </div>
    </div>
  );
}

function Strip(props: { title: string; colour: string; className?: string; children: React.ReactNode }) {
  const { title, colour, children } = props;
  return (
    <section
      className={cn(
        "flex flex-col rounded border border-black/80 bg-linear-to-b from-zinc-800/80 to-zinc-900/80 pb-2 shadow-[inset_0_1px_0_#ffffff12]",
        props.className,
      )}
    >
      <header className="flex items-center gap-1.5 border-b border-black/60 px-2 py-1.5">
        <span className="size-1.5 rounded-full" style={{ background: colour, boxShadow: `0 0 6px ${colour}` }} />
        <span className="text-[10px] font-semibold tracking-[0.2em] text-zinc-200 uppercase">{title}</span>
      </header>
      {children}
    </section>
  );
}

/** A fader's level in decibels, as a desk's scribble strip shows it */
function Readout({ value, colour }: { value: number; colour: string }) {
  return (
    <div
      className="mx-2 mt-2 [@container_(height<40rem)]:mt-1 rounded-sm border border-black bg-black/70 py-0.5 text-center font-mono text-[10px] tabular-nums"
      style={{ color: colour }}
    >
      {value === 0 ? "-inf" : (20 * Math.log10(value)).toFixed(1)} dB
    </div>
  );
}

/** A vertical fader: its cap goes to wherever on the track is pressed */
function Fader({ k, value, colour, onChange }: ControlProps) {
  const range = audioRanges[k];
  const [min, max] = range;
  const frac = (value - min) / (max - min);
  const dragging = useRef(false);

  const follow = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const up = 1 - (e.clientY - rect.top - faderCapPx / 2) / (rect.height - faderCapPx);
    onChange(snap(min + Math.min(1, Math.max(0, up)) * (max - min), range));
  };

  return (
    <div
      {...sliderProps(k, value, onChange)}
      title={k}
      className="relative w-9 cursor-ns-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
      style={{ backgroundImage: faderTicks }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        follow(e);
      }}
      onPointerMove={(e) => dragging.current && follow(e)}
      onPointerUp={() => void (dragging.current = false)}
      onPointerCancel={() => void (dragging.current = false)}
      onDoubleClick={() => onChange(audioDefaults[k])}
    >
      <div className="absolute inset-y-2 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-black shadow-[inset_0_0_2px_#000,0_1px_0_#ffffff14]" />
      <div
        className="absolute left-1/2 w-7 -translate-x-1/2 rounded-sm border border-black shadow-[0_3px_5px_#000c]"
        style={{
          height: faderCapPx,
          bottom: `calc(${frac} * (100% - ${faderCapPx}px))`,
          backgroundImage: "linear-gradient(#71717a, #3f3f46 45%, #27272a 55%, #52525b)",
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2" style={{ background: colour }} />
      </div>
    </div>
  );
}

/** What makes a `div` a slider to the keyboard and to a screen reader */
function sliderProps(k: AudioKey, value: number, onChange: (value: number) => void) {
  const range = audioRanges[k];
  const [min, max, step] = range;
  return {
    role: "slider",
    tabIndex: 0,
    "aria-label": k,
    "aria-valuemin": min,
    "aria-valuemax": max,
    "aria-valuenow": value,
    onKeyDown(e: React.KeyboardEvent) {
      const sign = keySigns[e.key];
      if (sign === undefined) return;
      e.preventDefault();
      onChange(snap(value + sign * step * (e.shiftKey ? 10 : 1), range));
    },
  } as const;
}

/** `value` on the nearest step, within the range */
function snap(value: number, [min, max, step]: [number, number, number]) {
  const stepped = min + Math.round((value - min) / step) * step;
  return Math.min(max, Math.max(min, Number(stepped.toFixed(4))));
}

type ControlProps = { k: AudioKey; value: number; colour: string; onChange(value: number): void };

type State = {
  canvas: null | HTMLCanvasElement;
  /** The spectrum's levels, read into each frame */
  bins: Uint8Array<ArrayBuffer>;
  frameId: number;
  /** Whether the meters and spectrum are redrawn each frame: off at first, and never saved */
  live: boolean;
  /** The tour's stop, or `null` whilst it is closed */
  help: null | HelpStep;
  rootEl: null | HTMLDivElement;
  /** The foot the desk's last step was on, so they alternate */
  stepSide: Side;
  /** Each meter's reading, `0` to `1`, kept so it can fall slowly */
  levels: Record<AudioMeterKey, number>;
  /** Each meter's shade, drawn down over its unlit part */
  meterEls: Record<AudioMeterKey, null | HTMLDivElement>;
  wave: Float32Array<ArrayBuffer>;
  /** Plays a step, a running one if `run` */
  playStep(run: boolean): void;
  /** Draws the meters and the spectrum each frame, whilst live and in sight */
  draw(): void;
  /** The engine changed, maybe from jsh: its config is kept in the pane's meta */
  onChange(): void;
  /** On a control, enter opens the tour there, or moves it on. Escape closes it */
  onKeyDown(e: React.KeyboardEvent): void;
  /** Its tab's button does the same */
  setDisabled(disabled: boolean): void;
  setHelp(step: null | HelpStep): void;
  setMeter(key: AudioMeterKey, level: number): void;
  /** Pauses or resumes the steps, and disables or enables the pane */
  setPaused(paused: boolean): void;
  /** Moves the tour on or back, round the ends */
  stepHelp(by: number): void;
  /** Starts or stops the live meters, leaving them empty when stopped */
  toggleLive(): void;
  /** Stops, else plays and enables a pane left paused */
  togglePlay(): void;
};

const meterKeys: AudioMeterKey[] = ["steps", "fx", "master"];

const stepsColour = graphColours.steps;
const fxColour = graphColours.fx;
const masterColour = graphColours.master;

/** The tour's order: across the desk, strip by strip */
const tour: HelpStep[] = ["intro", "steps", "fx", "master"];

const sfxLabels: Record<SfxKey, string> = {
  phaser: "fire",
  hit: "hit",
  armour: "armour",
  ghost: "ghost",
  wall: "wall",
};
const whenLabels: Record<HelpWhen, string> = {
  now: "heard at once",
  note: "from the next step",
};

const keySigns: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };

/** The spectrum's span, drawn on a log scale */
const spectrumHz = [20, 8000];
/** The quietest level a meter shows */
const meterFloorDb = 48;
/** How far a meter may fall in a frame */
const meterFall = 0.015;
const faderCapPx = 22;

const meterGradient = "linear-gradient(to top, #22c55e 0 62%, #eab308 62% 84%, #ef4444 84%)";
const meterSegments = "repeating-linear-gradient(to top, transparent 0 3px, #000 3px 4px)";
const faderTicks = "repeating-linear-gradient(to bottom, #ffffff2e 0 1px, transparent 1px 10%)";
const deskTexture = "repeating-linear-gradient(90deg, #ffffff05 0 1px, transparent 1px 3px)";

/** A fader takes what height its strip has left, between a stub and a full throw */
const faderClass = "min-h-20 max-h-60 flex-1 basis-40 [@container_(height<40rem)]:min-h-16";

const helpButtonClass =
  "grid size-6 cursor-pointer place-items-center rounded-sm bg-zinc-800 text-zinc-300 hover:bg-zinc-700";

const viewButtonClass =
  "grid size-7 cursor-pointer place-items-center rounded-sm bg-zinc-800 text-zinc-400 hover:bg-zinc-700";

const buttonClass = cn(
  "grid size-8 cursor-pointer place-items-center rounded-sm border border-black text-zinc-300",
  "bg-linear-to-b from-zinc-700 to-zinc-800 hover:from-zinc-600 active:translate-y-px",
);
