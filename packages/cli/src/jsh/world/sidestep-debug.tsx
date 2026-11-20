/// <reference path="./worker/jsh-worker.d.ts" />

import { cn, tw } from "@npc-cli/util";
import { Picker } from "@npc-cli/util/picker";
import { Fragment, useEffect, useState } from "react";

/** Sidestep's SkipNet pane: the kind npcs try next, its limits, and where and when they go back */
export function SidestepDebug({ w, s, kinds, backs, rules }: Props) {
  const [, setTick] = useState(0);
  useEffect(() => rules.listen(() => setTick((n) => n + 1)), [rules]);
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
  const ruleRows = rules.list();
  return (
    <div className={rootClass}>
      <div className={cn(boxClass, generalClass)}>
        <div className={sectionClass}>
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
        </div>

        <div className={sectionClass}>
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

      {ruleRows.length > 0 && (
        <div className={cn(boxClass, rulesClass)}>
          {heading("rules", `per npc in ${w.mapKey}`, true)}
          {s.open.rules && (
            <div className={gridClass}>
              {ruleRows.map(({ npcKey, text, spawned }) => (
                <Fragment key={npcKey}>
                  <span
                    className={cn(ruleClass, spawned === false && "opacity-50")}
                    title={`debug: sidestep for:${npcKey}`}
                  >
                    {npcKey} <span className={labelClass}>{text}</span>
                  </span>
                  <button
                    type="button"
                    className={removeClass}
                    title={`debug: remove ${npcKey}'s rule`}
                    onClick={() => {
                      rules.remove(npcKey);
                      touch();
                    }}
                  >
                    ×
                  </button>
                </Fragment>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type Props = {
  w: JshCli.WorldState;
  s: SidestepDebugState;
  kinds: WW.SidestepYield[];
  backs: SidestepBack[];
  rules: SidestepRules;
};

/** One npc's own sidestep over the defaults: only the fields it sets */
export type SidestepRule = Partial<Pick<SidestepDebugState, "kind" | "back" | "chain">> & {
  tune?: Partial<Record<WW.SidestepYield, Record<string, number>>>;
  returns?: Partial<SidestepReturns>;
};

/** The per-npc rules as the pane lists them, greyed if not spawned, each removable */
export type SidestepRules = {
  list(): { npcKey: string; text: string; spawned: boolean }[];
  listen(onChange: () => void): () => void;
  remove(npcKey: string): void;
};

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

/** The item's sections of fields: the kind's tuning, when they go back, and per-npc rules */
export type SidestepOpen = { tune: boolean; returns: boolean; rules: boolean };

/** Metres their walker must be from the spot before they go back: `clear`, else `idle` once the walker has stopped */
export type SidestepReturns = { clear: number; idle: number };

/** Once the walker has gone: back to where their latest step began, to where they stood before the first, or stay */
export type SidestepBack = "last" | "home" | "stay";

const returnTitles: Record<string, string> = {
  clear: "debug: back once their walker is this far from the spot, in metres",
  idle: "debug: or once their walker has stopped this far from it",
};

/** The defaults, then this map's rules, each a tinted box in SkipNet's greys */
const rootClass = tw("flex flex-col gap-3 w-full max-w-60 p-1 font-mono text-xs text-mac-text @sm:max-w-[34rem]");
const sectionClass = tw("flex flex-col gap-1.5");
const boxClass = tw("flex flex-col gap-1.5 rounded border border-mac-edge p-1.5");
/** One column, else side by side in a wide enough container, e.g. SkipNet stacked */
const generalClass = tw("bg-mac-text/[0.07] @sm:grid @sm:grid-cols-2 @sm:items-start @sm:gap-x-5");
const rulesClass = tw("bg-mac-select/20");
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
const chainClass = tw("flex items-center gap-1.5 pl-3 cursor-pointer @sm:col-span-2");
const checkClass = tw("cursor-pointer accent-mac-select");
const ruleClass = tw("min-w-0 break-words");
const removeClass = tw("justify-self-end cursor-pointer px-1 text-mac-muted hover:text-mac-text");
