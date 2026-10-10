import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, useStateRef } from "@npc-cli/util";
import {
  ArrowCounterClockwiseIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CopyIcon,
  FlowArrowIcon,
  PlayIcon,
  QuestionIcon,
  SlidersHorizontalIcon,
  StopIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useContext, useEffect, useRef } from "react";
import {
  type Ambience,
  type AmbienceConfig,
  type AmbienceKey,
  type AmbienceMeterKey,
  ambienceDefaults,
  ambienceRanges,
  ambienceUnits,
  createAmbience,
} from "./ambience";
import { graphColours } from "./graph-data";
import { type HelpStep, help, helpIntro } from "./help";
import { Graph } from "./NodeGraph";
import type { AudioUiMeta } from "./schema";

/** Plays the ambience and tunes it by ear, laid out as a mixing desk: a strip per channel */
export default function Audio({ meta }: { meta: AudioUiMeta }) {
  const { uiStoreApi } = useContext(UiContext);

  const state = useStateRef(
    (): State => ({
      canvas: null,
      config: { ...ambienceDefaults, ...meta.config },
      engine: null,
      frameId: 0,
      help: null,
      rootEl: null,
      levels: { drone: 0, air: 0, choir: 0, master: 0 },
      meterEls: { drone: null, air: null, choir: null, master: null },
      wave: new Float32Array(1024),

      play() {
        state.engine = createAmbience(state.config);
        state.draw();
        state.update();
      },
      stop() {
        state.engine?.stop();
        state.engine = null;
        cancelAnimationFrame(state.frameId);
        for (const key of meterKeys) state.setMeter(key, 0);
        const { canvas } = state;
        canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
        state.update();
      },
      setConfig(partial) {
        state.config = { ...state.config, ...partial };
        state.engine?.set(partial);
        uiStoreApi.setUiMeta(meta.id, (draft) => void ((draft as AudioUiMeta).config = state.config));
        state.update();
      },
      setHelp(step) {
        state.set({ help: step });
        const el = step === null ? null : state.rootEl?.querySelector(`[data-help="${step}"]`);
        el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        // focused, so the arrow keys turn it at once
        el?.querySelector<HTMLElement>('[role="slider"]')?.focus({ preventScroll: true });
      },
      onKeyDown(e) {
        if (e.key === "Escape") return state.setHelp(null);
        const key = (e.target as HTMLElement).closest<HTMLElement>("[data-help]")?.dataset.help as AmbienceKey;
        if (e.key !== "Enter" || key === undefined) return;
        e.preventDefault();
        state.help === null ? state.setHelp(key) : state.stepHelp(e.shiftKey ? -1 : 1);
      },
      stepHelp(by) {
        const at = state.help === null ? 0 : tour.indexOf(state.help) + by;
        state.setHelp(tour[(at + tour.length) % tour.length]);
      },
      setMeter(key, level) {
        state.levels[key] = level;
        const el = state.meterEls[key];
        if (el) el.style.height = `${(1 - level) * 100}%`;
      },
      draw() {
        state.frameId = requestAnimationFrame(state.draw);
        const { canvas, engine } = state;
        if (!engine) return;

        for (const key of meterKeys) {
          engine.meters[key].getFloatTimeDomainData(state.wave);
          let peak = 0;
          for (const sample of state.wave) peak = Math.max(peak, Math.abs(sample));
          const level = Math.min(1, Math.max(0, 1 + (20 * Math.log10(peak || 1e-6)) / meterFloorDb));
          state.setMeter(key, Math.max(level, state.levels[key] - meterFall));
        }

        const g = canvas?.getContext("2d");
        if (!canvas || !g) return;
        const bins = new Uint8Array(engine.analyser.frequencyBinCount);
        engine.analyser.getByteFrequencyData(bins);
        const { width, height } = canvas;
        g.clearRect(0, 0, width, height);
        g.fillStyle = "#4ade80";
        const hzPerBin = engine.ctx.sampleRate / engine.analyser.fftSize;
        for (let x = 0; x < width; x += 3) {
          const hz = spectrumHz[0] * (spectrumHz[1] / spectrumHz[0]) ** (x / width);
          const level = bins[Math.min(bins.length - 1, Math.round(hz / hzPerBin))] / 255;
          g.fillRect(x, height * (1 - level), 2, height * level);
        }
      },
    }),
    { deps: [uiStoreApi] },
  );

  useEffect(() => () => state.stop(), []);

  useEffect(() => {
    void state.engine?.ctx[meta.disabled ? "suspend" : "resume"]();
  }, [meta.disabled]);

  // an edit of the engine is heard without pressing play again
  useEffect(() => {
    if (state.engine === null) return;
    state.stop();
    state.play();
  }, [createAmbience]);

  const playing = state.engine !== null;
  const view = meta.view ?? "desk";
  const setView = (next: AudioUiMeta["view"]) => {
    state.setHelp(null);
    uiStoreApi.setUiMeta(meta.id, (draft) => void ((draft as AudioUiMeta).view = next));
  };
  /** Touring, the control explained stands out and pressing another moves the tour to it */
  const helped = (key: AmbienceKey) => ({
    "data-help": key,
    className: cn(
      "rounded transition-opacity",
      state.help !== null && (state.help === key ? "bg-white/10 ring-2 ring-white/70" : "opacity-40"),
    ),
    onFocusCapture: () => state.help !== null && state.help !== key && state.setHelp(key),
  });
  const knob = (key: AmbienceKey, colour: string) => (
    <div key={key} {...helped(key)}>
      <Knob k={key} value={state.config[key]} colour={colour} onChange={(v) => state.setConfig({ [key]: v })} />
    </div>
  );
  const fader = (key: AmbienceKey & AmbienceMeterKey, colour: string, heightClass = "h-52 @max-lg:h-40") => (
    <div className={cn("mt-auto flex shrink-0 justify-center gap-3 px-2 pt-3", heightClass)}>
      <div
        className="relative h-full w-2.5 overflow-hidden rounded-sm bg-black ring-1 ring-black"
        style={{ backgroundImage: meterGradient }}
      >
        <div
          ref={(el) => void (state.meterEls[key] = el)}
          className="absolute inset-x-0 top-0 bg-zinc-950/95"
          style={{ height: `${(1 - state.levels[key]) * 100}%` }}
        />
        <div className="absolute inset-0" style={{ backgroundImage: meterSegments }} />
      </div>
      <div {...helped(key)} style={{ height: "100%" }}>
        <Fader k={key} value={state.config[key]} colour={colour} onChange={(v) => state.setConfig({ [key]: v })} />
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
        {view === "graph" && (
          <button
            type="button"
            title={playing ? "stop" : "play"}
            className={cn(viewButtonClass, playing && "text-emerald-300")}
            onClick={() => (playing ? state.stop() : state.play())}
          >
            {playing ? <StopIcon className="size-4" weight="fill" /> : <PlayIcon className="size-4" weight="fill" />}
          </button>
        )}
      </div>

      {view === "graph" && (
        <div className="flex size-full overflow-auto p-3 pt-11">
          <Graph config={state.config} playing={playing} />
        </div>
      )}

      {/* hidden, not unmounted, so its meters and screen keep their elements */}
      <div
        className={cn(
          "@container flex size-full overflow-auto p-3 pt-11",
          state.help !== null && "pb-48",
          view === "graph" && "hidden",
        )}
      >
        <div
          className="m-auto flex max-w-full flex-wrap justify-center gap-1.5 @max-lg:w-full rounded-lg border border-black bg-[#1b1d21] p-2 shadow-[inset_0_1px_0_#ffffff14,0_8px_24px_#000a]"
          style={{ backgroundImage: deskTexture }}
        >
          {strips.map(({ key, title, colour, knobs, knobsClass }) => (
            <Strip key={key} title={title} colour={colour} className="@max-lg:grow">
              <div className={cn("grid justify-center gap-x-1 gap-y-2.5 px-2 pt-2", knobsClass)}>
                {knobs.map((k) => knob(k, colour))}
              </div>
              {fader(key, colour)}
              <Readout value={state.config[key]} colour={colour} />
            </Strip>
          ))}

          {/* too narrow for a fourth strip, it lies along the foot of the desk */}
          <Strip title="master" colour={masterColour} className="@max-lg:basis-full">
            <div className="flex flex-1 flex-col @max-lg:flex-row @max-lg:items-center @max-lg:justify-center @max-lg:gap-2">
              <div className="flex flex-col items-center gap-2.5 px-2 pt-2">
                <canvas
                  ref={state.ref("canvas")}
                  width={132}
                  height={56}
                  className="h-14 w-33 @min-lg:@max-xl:w-17 rounded-sm border border-black bg-[#07140c] shadow-[inset_0_0_8px_#000]"
                />
                <div className="grid grid-cols-4 gap-1 @min-lg:@max-xl:grid-cols-2">
                  <button
                    type="button"
                    title={playing ? "stop" : "play"}
                    className={cn(buttonClass, playing && "text-emerald-300 shadow-[0_0_8px_#34d39966]")}
                    onClick={() => (playing ? state.stop() : state.play())}
                  >
                    {playing ? (
                      <StopIcon className="size-4" weight="fill" />
                    ) : (
                      <PlayIcon className="size-4" weight="fill" />
                    )}
                  </button>
                  <button
                    type="button"
                    title="reset to defaults"
                    className={buttonClass}
                    onClick={() => state.setConfig(ambienceDefaults)}
                  >
                    <ArrowCounterClockwiseIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    title="copy config"
                    className={buttonClass}
                    onClick={() => void navigator.clipboard.writeText(JSON.stringify(state.config, null, 2))}
                  >
                    <CopyIcon className="size-4" />
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
              <div className="flex justify-center px-2 pt-2.5">{knob("reverb", masterColour)}</div>
              <div className="mt-auto flex flex-col @max-lg:mt-0">
                {fader("master", masterColour, "h-52 @max-lg:h-28")}
                <Readout value={state.config.master} colour={masterColour} />
              </div>
            </div>
          </Strip>
        </div>
      </div>

      {state.help !== null && (
        <HelpCard
          step={state.help}
          value={state.help === "intro" ? null : state.config[state.help]}
          onStep={state.stepHelp}
          onClose={() => state.setHelp(null)}
        />
      )}
    </div>
  );
}

/** The tour's caption, along the foot of the pane so it covers no strip's knobs */
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
              entry.live ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-300",
            )}
          >
            {entry.live ? "heard at once" : "from the next chord"}
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
          {ambienceUnits[step]} · range {ambienceRanges[step][0]} to {ambienceRanges[step][1]}
          {ambienceUnits[step]} · default {ambienceDefaults[step]}
          {ambienceUnits[step]}
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
      className="mx-2 mt-2 rounded-sm border border-black bg-black/70 py-0.5 text-center font-mono text-[10px] tabular-nums"
      style={{ color: colour }}
    >
      {value === 0 ? "-inf" : (20 * Math.log10(value)).toFixed(1)} dB
    </div>
  );
}

/** Turned by dragging up and down, or the arrow keys. A double click restores its default */
function Knob({ k, value, colour, onChange }: ControlProps) {
  const range = ambienceRanges[k];
  const [min, max] = range;
  const frac = (value - min) / (max - min);
  const drag = useRef<null | { y: number; value: number }>(null);

  return (
    <div className="flex flex-col items-center gap-1" title={k}>
      <div
        {...sliderProps(k, value, onChange)}
        className="cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, value };
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const turned = (drag.current.y - e.clientY) / knobTravelPx;
          onChange(snap(drag.current.value + turned * (max - min), range));
        }}
        onPointerUp={() => void (drag.current = null)}
        onPointerCancel={() => void (drag.current = null)}
        onDoubleClick={() => onChange(ambienceDefaults[k])}
      >
        <svg viewBox="0 0 40 40" className="size-10" aria-hidden="true">
          <circle {...knobArc} stroke="#09090b" strokeDasharray={`${knobSweep} ${knobRound}`} />
          <circle {...knobArc} stroke={colour} strokeDasharray={`${knobSweep * frac} ${knobRound}`} />
          <circle cx={20} cy={20} r={11.5} fill="#3f3f46" stroke="#18181b" strokeWidth={1.5} />
          <circle cx={20} cy={19} r={9} fill="#52525b" />
          <line
            x1={20}
            y1={9.5}
            x2={20}
            y2={15}
            stroke="#fafafa"
            strokeWidth={2}
            strokeLinecap="round"
            transform={`rotate(${-135 + 270 * frac} 20 20)`}
          />
        </svg>
      </div>
      <span className="text-[9px] leading-none tracking-wider text-zinc-400 uppercase">{labels[k] ?? k}</span>
      <span className="font-mono text-[9px] leading-none tabular-nums text-zinc-500">
        {value}
        {ambienceUnits[k]}
      </span>
    </div>
  );
}

/** A vertical fader: its cap goes to wherever on the track is pressed */
function Fader({ k, value, colour, onChange }: ControlProps) {
  const range = ambienceRanges[k];
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
      className="relative h-full w-9 cursor-ns-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
      style={{ backgroundImage: faderTicks }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        follow(e);
      }}
      onPointerMove={(e) => dragging.current && follow(e)}
      onPointerUp={() => void (dragging.current = false)}
      onPointerCancel={() => void (dragging.current = false)}
      onDoubleClick={() => onChange(ambienceDefaults[k])}
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
function sliderProps(k: AmbienceKey, value: number, onChange: (value: number) => void) {
  const range = ambienceRanges[k];
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

type ControlProps = { k: AmbienceKey; value: number; colour: string; onChange(value: number): void };

type State = {
  canvas: null | HTMLCanvasElement;
  config: AmbienceConfig;
  /** `null` whilst stopped */
  engine: null | Ambience;
  frameId: number;
  /** The tour's stop, or `null` whilst it is closed */
  help: null | HelpStep;
  rootEl: null | HTMLDivElement;
  /** Each meter's reading, `0` to `1`, kept so it can fall slowly */
  levels: Record<AmbienceMeterKey, number>;
  /** Each meter's shade, drawn down over its unlit part */
  meterEls: Record<AmbienceMeterKey, null | HTMLDivElement>;
  wave: Float32Array<ArrayBuffer>;
  play(): void;
  stop(): void;
  setConfig(partial: Partial<AmbienceConfig>): void;
  setHelp(step: null | HelpStep): void;
  /** On a control, enter opens the tour there, or moves it on. Escape closes it */
  onKeyDown(e: React.KeyboardEvent): void;
  /** Moves the tour on or back, round the ends */
  stepHelp(by: number): void;
  setMeter(key: AmbienceMeterKey, level: number): void;
  /** Draws the meters and the spectrum each frame whilst playing */
  draw(): void;
};

const meterKeys: AmbienceMeterKey[] = ["drone", "air", "choir", "master"];

type StripDef = {
  /** Its fader's setting, which is its meter's name too */
  key: AmbienceKey & AmbienceMeterKey;
  title: string;
  colour: string;
  knobs: AmbienceKey[];
  /** Its knobs' columns, fewer where the pane is narrow */
  knobsClass: string;
};

const strips: StripDef[] = [
  {
    key: "drone",
    title: "engine",
    colour: graphColours.drone,
    knobs: ["droneHz", "droneCutoff"],
    knobsClass: "grid-cols-[3rem]",
  },
  { key: "air", title: "air", colour: graphColours.air, knobs: ["airHz"], knobsClass: "grid-cols-[3rem]" },
  {
    key: "choir",
    title: "choir",
    colour: graphColours.choir,
    knobs: [
      "choirDry",
      "choirCutoff",
      "choirTranspose",
      "choirDetune",
      "voices",
      "spread",
      "chordSecs",
      "rest",
      "stagger",
      "attack",
      "release",
      "grain",
      "crossfade",
    ],
    knobsClass: "grid-cols-[repeat(4,3rem)] @max-xl:grid-cols-[repeat(3,3rem)]",
  },
];

const masterColour = graphColours.master;

/** The tour's order: across the desk, each strip's fader then its knobs */
const tour: HelpStep[] = ["intro", ...strips.flatMap(({ key, knobs }) => [key, ...knobs]), "reverb", "master"];

/** What a knob is called on the desk, where its key says more than fits */
const labels: Partial<Record<AmbienceKey, string>> = {
  droneHz: "pitch",
  droneCutoff: "tone",
  airHz: "tone",
  choirDry: "dry",
  choirCutoff: "tone",
  choirTranspose: "transp",
  choirDetune: "detune",
  chordSecs: "chord",
  crossfade: "x-fade",
};

const keySigns: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };

/** The spectrum's span, drawn on a log scale */
const spectrumHz = [20, 8000];
/** The quietest level a meter shows */
const meterFloorDb = 48;
/** How far a meter may fall in a frame */
const meterFall = 0.015;
/** How far a knob is dragged from one end of its range to the other */
const knobTravelPx = 160;
const faderCapPx = 22;

const knobRound = 2 * Math.PI * 16;
/** A knob turns through three quarters of a circle */
const knobSweep = knobRound * 0.75;
const knobArc = {
  cx: 20,
  cy: 20,
  r: 16,
  fill: "none",
  strokeWidth: 3,
  strokeLinecap: "round",
  transform: "rotate(135 20 20)",
} as const;

const meterGradient = "linear-gradient(to top, #22c55e 0 62%, #eab308 62% 84%, #ef4444 84%)";
const meterSegments = "repeating-linear-gradient(to top, transparent 0 3px, #000 3px 4px)";
const faderTicks = "repeating-linear-gradient(to bottom, #ffffff2e 0 1px, transparent 1px 10%)";
const deskTexture = "repeating-linear-gradient(90deg, #ffffff05 0 1px, transparent 1px 3px)";

const helpButtonClass =
  "grid size-6 cursor-pointer place-items-center rounded-sm bg-zinc-800 text-zinc-300 hover:bg-zinc-700";

const viewButtonClass =
  "grid size-7 cursor-pointer place-items-center rounded-sm bg-zinc-800 text-zinc-400 hover:bg-zinc-700";

const buttonClass = cn(
  "grid size-8 cursor-pointer place-items-center rounded-sm border border-black text-zinc-300",
  "bg-linear-to-b from-zinc-700 to-zinc-800 hover:from-zinc-600 active:translate-y-px",
);
