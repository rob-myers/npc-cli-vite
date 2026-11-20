/// <reference path="./worker/jsh-worker.d.ts" />

import { cn, tw } from "@npc-cli/util";
import { Picker } from "@npc-cli/util/picker";
import { Fragment, useState } from "react";

/** Sidestep's SkipNet pane: the kind npcs try next, its limits, and where and when they go back */
export function SidestepDebug({ w, s, kinds, backs }: Props) {
  const [, setTick] = useState(0);
  /** Redraws, and gives the keys back to the World */
  const touch = () => {
    setTick((n) => n + 1);
    w.view.focus();
  };
  /** A section's heading, its caret showing or hiding its fields when it has any */
  const heading = (name: keyof SidestepOpen, label: string, hasFields: boolean) =>
    hasFields ? (
      <button
        type="button"
        className={cn(headingClass, "cursor-pointer hover:text-mac-text")}
        title={`debug: ${s.open[name] ? "hide" : "show"} ${label}'s fields`}
        onClick={() => {
          s.open[name] = !s.open[name];
          touch();
        }}
      >
        <span className="w-2">{s.open[name] ? "▾" : "▸"}</span>
        {label}
      </button>
    ) : (
      <div className={headingClass}>
        <span className="w-2" />
        {label}
      </div>
    );
  /** A row per value, in metres, written straight into `values` */
  const fields = (values: Record<string, number>, scope: string, titleOf: (key: string) => string) =>
    Object.entries(values).map(([key, value]) => (
      <Fragment key={`${scope}.${key}`}>
        <span className={labelClass} title={titleOf(key)}>
          {key}
        </span>
        <span className="flex items-center gap-1 justify-self-end">
          <input
            type="number"
            step={0.1}
            min={0}
            defaultValue={value}
            aria-label={key}
            className={inputClass}
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              if (Number.isFinite(n)) values[key] = n;
            }}
            onKeyDown={(e) => {
              e.stopPropagation(); // else wasd and the like reach the World
              if (e.key === "Enter") w.view.focus();
            }}
          />
          <span className={labelClass}>m</span>
        </span>
      </Fragment>
    ));
  const tune = s.tune[s.kind];
  const hasTune = Object.keys(tune).length > 0;
  const hasReturns = s.back !== "stay";
  return (
    <div className={rootClass}>
      {heading("tune", "make way", hasTune)}
      <div className={gridClass}>
        <span className={labelClass}>kind</span>
        <Picker
          value={s.kind}
          options={kinds}
          title="debug: how npcs make way next"
          className={pickerClass}
          popupClassName={pickerPopupClass}
          onChange={(kind) => {
            s.kind = kind;
            touch();
          }}
        />
        {hasTune && s.open.tune && fields(tune, s.kind, (key) => `debug: ${s.kind}'s ${key}, in metres`)}
      </div>

      {heading("returns", "go back", hasReturns)}
      <div className={gridClass}>
        <span className={labelClass}>to</span>
        <Picker
          value={s.back}
          options={backs}
          title="debug: once the walker has gone, back to their last spot, to home, or not at all"
          className={pickerClass}
          popupClassName={pickerPopupClass}
          onChange={(back) => {
            s.back = back;
            touch();
          }}
        />
        {hasReturns && s.open.returns && fields(s.returns, "back", (key) => returnTitles[key])}
      </div>

      <label
        className={chainClass}
        title="debug: npcs stepping aside or going back look too, so one's step may set others off"
      >
        <input
          type="checkbox"
          defaultChecked={s.chain}
          className={checkClass}
          onChange={(e) => {
            s.chain = e.target.checked;
            touch();
          }}
          onKeyDown={(e) => e.stopPropagation()}
        />
        chain
        <span className={labelClass}>others look too</span>
      </label>
    </div>
  );
}

type Props = { w: JshCli.WorldState; s: SidestepDebugState; kinds: WW.SidestepYield[]; backs: SidestepBack[] };

/** What the hud's sidestep item reads and sets: the watcher's own */
export type SidestepDebugState = {
  kind: WW.SidestepYield;
  back: SidestepBack;
  tune: WW.SidestepTune;
  returns: SidestepReturns;
  /** Which sections of fields are open */
  open: SidestepOpen;
  /** Npcs stepping aside or going back look too, as walkers: crowds may chain */
  chain: boolean;
};

/** The item's sections of fields: the kind's tuning, and when they go back */
export type SidestepOpen = { tune: boolean; returns: boolean };

/** Metres their walker must be from the spot before they go back: `clear`, else `idle` once the walker has stopped */
export type SidestepReturns = { clear: number; idle: number };

/** Once the walker has gone: back to where their latest step began, to where they stood before the first, or stay */
export type SidestepBack = "last" | "home" | "stay";

const returnTitles: Record<string, string> = {
  clear: "debug: back once their walker is this far from the spot, in metres",
  idle: "debug: or once their walker has stopped this far from it",
};

/** Sections of label and value rows, in SkipNet's greys */
const rootClass = tw("flex flex-col gap-1.5 w-full max-w-60 p-1 font-mono text-xs text-mac-text");
const headingClass = tw(
  "flex items-center gap-1 pb-0.5 border-b border-mac-edge text-left text-[10px] uppercase tracking-widest text-mac-muted",
);
const gridClass = tw("grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 pl-3 mb-1");
const labelClass = tw("text-mac-muted");
const pickerClass = tw("justify-self-end border-mac-edge bg-mac-window text-mac-text hover:bg-mac-select/15");
/** As SkipNet's title pickers' popups */
const pickerPopupClass = tw(
  "font-mono rounded-none! border-mac-edge! bg-mac-window! text-mac-text! [&_[data-selected]]:font-bold [&_[data-highlighted]]:bg-mac-select/15!",
);
const inputClass = tw(
  "w-12 rounded border border-mac-edge bg-mac-window px-1 text-right text-mac-text outline-none focus:border-mac-select [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none",
);
const chainClass = tw("flex items-center gap-1.5 pl-3 cursor-pointer");
const checkClass = tw("cursor-pointer accent-mac-select");
