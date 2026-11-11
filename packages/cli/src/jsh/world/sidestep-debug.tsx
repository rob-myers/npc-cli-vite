/// <reference path="./worker/jsh-worker.d.ts" />

import { tw } from "@npc-cli/util";
import { Picker } from "@npc-cli/util/picker";
import { useState } from "react";

/** Sidestep's item on the hud, whilst hud debug is on: the kind npcs try next, its limits, and where and when they go back */
export function SidestepDebug({ w, s, kinds, backs }: Props) {
  const [, setTick] = useState(0);
  /** Redraws, and gives the keys back to the World */
  const touch = () => {
    setTick((n) => n + 1);
    w.view.focus();
  };
  /** A section's toggle, opening or closing it, then its fields whilst open. None for a section without fields */
  const section = (name: keyof SidestepOpen, label: string, body: () => React.ReactNode[]) => {
    const rows = body();
    if (rows.length === 0) return null;
    return [
      <button
        key={`${name}.toggle`}
        type="button"
        className={toggleClass}
        title={`debug: ${s.open[name] ? "hide" : "show"} ${label}`}
        onClick={() => {
          s.open[name] = !s.open[name];
          touch();
        }}
      >
        {s.open[name] ? "▾" : "▸"} {label}
      </button>,
      ...(s.open[name] ? rows : []),
    ];
  };
  /** A number field per value, written straight into `values` */
  const fields = (values: Record<string, number>, scope: string, titleOf: (key: string) => string) =>
    Object.entries(values).map(([key, value]) => (
      <label key={`${scope}.${key}`} className={fieldClass} title={titleOf(key)}>
        {key}
        <input
          type="number"
          step={0.1}
          min={0}
          defaultValue={value}
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
      </label>
    ));
  return (
    <div className={rootClass}>
      <Picker
        value={s.kind}
        options={kinds}
        title="debug: how npcs make way next"
        className={pickerClass}
        popupClassName="font-mono"
        onChange={(kind) => {
          s.kind = kind;
          touch();
        }}
      />
      {section("tune", "tuning", () => fields(s.tune[s.kind], s.kind, (key) => `debug: ${s.kind}'s ${key}, in metres`))}
      <Picker
        value={s.back}
        options={backs}
        title="debug: once the walker has gone, back to their last spot, to home, or not at all"
        className={pickerClass}
        popupClassName="font-mono"
        onChange={(back) => {
          s.back = back;
          touch();
        }}
      />
      {s.back !== "stay" && section("returns", "when", () => fields(s.returns, "back", (key) => returnTitles[key]))}
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

/** One column as wide as its widest row: the kind, a row per tuning, then where and when they go back */
const rootClass = tw("grid w-fit grid-cols-1 gap-1 font-mono text-xs");
const pickerClass = tw("w-full justify-between border-neutral-700 bg-neutral-900/60 text-neutral-300");
const toggleClass = tw("cursor-pointer text-left text-neutral-500 hover:text-neutral-300");
const chainClass = tw("flex cursor-pointer items-center gap-1.5 pl-1 text-neutral-400");
const checkClass = tw("cursor-pointer accent-neutral-500");
const fieldClass = tw("flex items-center justify-between gap-1.5 pl-1 text-neutral-400");
const inputClass = tw(
  "w-11 rounded border border-neutral-700 bg-neutral-900/60 px-1 text-right text-neutral-300 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none",
);
