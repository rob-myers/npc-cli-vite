import { Select } from "@base-ui/react/select";
import { cn, useStateRef } from "@npc-cli/util";
import { CaretDownIcon, PersonSimpleIcon } from "@phosphor-icons/react";
import { useContext, useEffect, useReducer, useState } from "react";
import type { AnimationClipKey } from "./NPCs";
import PsiControls from "./PsiControls";
import { Glyphed } from "./TalkThread";
import type { State as WorldState } from "./World";
import { WorldContext } from "./world-context";

/**
 * One bubble over an npc, following them: the line they last said, for a few seconds, and a debug
 * section when opened (`openDebug`) — shown through `w.html`, as a route node's is
 */
export default function NpcBubbles() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      debugs: new Set(),
      lines: new Map(),

      openDebug(npcKey, { focus = false } = {}) {
        state.debugs.add(npcKey);
        state.sync(npcKey);
        if (focus === true) w.html.focus(bubbleKey(npcKey));
      },
      toggleDebug(npcKey) {
        if (state.debugs.has(npcKey)) state.closeDebug(npcKey);
        else state.openDebug(npcKey);
      },
      closeDebug(npcKey) {
        state.debugs.delete(npcKey);
        state.sync(npcKey);
      },
      say(npcKey, words, { secs = lineSecs, hold = false } = {}) {
        if (!(npcKey in w.n)) return;
        state.lines.set(npcKey, { words, secs, held: hold });
        state.sync(npcKey);
      },
      release(...npcKeys) {
        for (const npcKey of npcKeys) {
          const line = state.lines.get(npcKey);
          if (line?.held !== true) continue;
          line.held = false;
          line.secs = lineSecs;
        }
      },
      onTick(delta) {
        for (const [npcKey, line] of state.lines) {
          if (line.held || (line.secs -= delta) > 0) continue;
          state.lines.delete(npcKey);
          state.sync(npcKey);
        }
      },
      sync(npcKey) {
        const npc = w.n[npcKey];
        const debug = state.debugs.has(npcKey);
        const line = state.lines.get(npcKey);
        if (npc === undefined || (debug === false && line === undefined)) return w.html.hide(bubbleKey(npcKey));
        w.html.show(
          bubbleKey(npcKey),
          { object: npc.skinnedMesh, offset: npc.bubbleOffset },
          debug ? <NpcBubble w={w} npcKey={npcKey} words={line?.words} /> : <SaidBubble words={line?.words ?? ""} />,
          // its close button closes the debug section alone: a line said stays up
          debug
            ? { onHide: () => state.debugs.delete(npcKey) && state.lines.has(npcKey) && state.sync(npcKey) }
            : { bare: true },
        );
      },
      delete(...npcKeys) {
        for (const npcKey of npcKeys) {
          state.debugs.delete(npcKey);
          state.lines.delete(npcKey);
        }
        w.html.hide(...npcKeys.map(bubbleKey));
      },
      setShown(npcKey, shown) {
        w.html.setShown(bubbleKey(npcKey), shown);
      },
    }),
  );

  w.bubble = state;

  return null;
}

/** Just the line said, click-through */
function SaidBubble({ words }: { words: string }) {
  return (
    <div className="mb-3 w-max max-w-[28rem] rounded-2xl border-2 border-white/30 bg-black/75 px-5 py-2 text-xl text-white/95">
      <Glyphed text={words} />
    </div>
  );
}

/** The line said, if any, over what debugging them needs */
function NpcBubble({ w, npcKey, words }: { w: WorldState; npcKey: string; words?: string }) {
  const [grKey, setGrKey] = useState(() => w.npc.npcToRoom.get(npcKey)?.grKey);
  const [pose, setPose] = useState(() => w.n[npcKey]?.anim.pose);
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    // not only theirs e.g. "spawned-many", "nav-updated" — and an unchanged key re-renders nothing
    const sub = w.events.subscribe({ next: () => setGrKey(w.npc.npcToRoom.get(npcKey)?.grKey) });
    // the pose changes on its own too e.g. walking, idling
    const id = setInterval(() => setPose(w.n[npcKey]?.anim.pose), posePollMs);
    return () => (sub.unsubscribe(), clearInterval(id));
  }, [w, npcKey]);

  const npc = w.n[npcKey];

  return (
    <div className="pointer-events-auto flex max-h-(--html-height,none) w-(--html-width,32rem) flex-col gap-3 overflow-y-auto rounded-2xl scrollbar-thin border-4 border-white/40 bg-black/70 px-5 py-4 text-lg text-white/90">
      {words !== undefined && (
        <div className="text-xl text-white/95">
          <Glyphed text={words} />
        </div>
      )}
      <div className="flex items-center gap-3">
        <PersonSimpleIcon className="size-9 shrink-0 text-white/80" weight="duotone" />
        <span className="truncate font-medium tracking-wide">{npcKey}</span>
      </div>
      {grKey !== undefined && (
        <span className="w-fit rounded-lg border border-white/20 bg-black/40 px-3 py-0.5 whitespace-nowrap">
          <span className="text-white/50">room </span>
          {grKey}
        </span>
      )}
      {npc !== undefined && (
        <Select.Root
          value={pose}
          onValueChange={(next) => {
            if (next === null || w.n[npcKey] === undefined) return;
            w.n[npcKey].anim.setPose(next);
            setPose(next);
          }}
        >
          <Select.Trigger className="flex min-w-0 items-center gap-2 rounded-lg border-2 border-white/20 bg-black/50 px-3 py-0.5 text-left outline-none cursor-pointer focus:border-white/60">
            <span className="text-white/50 pr-1">anim</span>
            <Select.Value className="min-w-0 flex-1 truncate" />
            <CaretDownIcon className="size-7 shrink-0 text-white/60" />
          </Select.Trigger>
          <Select.Portal container={w.rootEl}>
            <Select.Positioner className="z-70" sideOffset={4} align="start" alignItemWithTrigger={false}>
              <Select.Popup className="max-h-60 overflow-auto rounded border border-slate-700 bg-slate-800 py-1 text-xs text-slate-300 shadow-lg scrollbar-thin">
                {(Object.keys(npc.clips) as AnimationClipKey[]).map((clipKey) => (
                  <Select.Item
                    key={clipKey}
                    value={clipKey}
                    className="px-3 py-1 cursor-pointer data-highlighted:bg-slate-700"
                  >
                    <Select.ItemText>{clipKey}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      )}
      {/* what they have: lit if so, and a press gives or takes it away */}
      <div className="flex gap-2">
        {(["psi", "phaser"] as const).map((name) => {
          const had = w.e.hasItem(npcKey, name);
          return (
            <button
              key={name}
              type="button"
              title={`${had ? "take away" : "give"} ${name}`}
              className={cn(
                "cursor-pointer rounded-lg border-2 px-3 py-0.5",
                had ? "border-amber-300/60 text-amber-200" : "border-white/20 text-white/40",
              )}
              onClick={() => {
                had ? w.e.revokeItem(npcKey, name) : w.e.giveItem(npcKey, name);
                rerender();
              }}
            >
              {name}
            </button>
          );
        })}
      </div>
      {npcKey === w.player?.key && <PsiControls w={w} />}
    </div>
  );
}

const bubbleKey = (npcKey: string) => `bubble:${npcKey}`;
/** Seconds a line said stays over them, whilst unpaused: long enough to be found, then read */
const lineSecs = 8;
/** Their pose changes on its own, and nothing announces it */
const posePollMs = 250;

export type State = {
  /** Whose debug section is open */
  debugs: Set<string>;
  /** The line each said last, and the seconds it has left — none whilst `held` */
  lines: Map<string, { words: string; secs: number; held: boolean }>;
  /** Opens their debug section — `focus` its close button, open already or not */
  openDebug(npcKey: string, opts?: { focus?: boolean }): void;
  toggleDebug(npcKey: string): void;
  closeDebug(npcKey: string): void;
  /** Over them for `secs`, replacing what they said before — or until released, when `hold` */
  say(npcKey: string, words: string, opts?: { secs?: number; hold?: boolean }): void;
  /** A held line starts its `lineSecs`, e.g. once answered */
  release(...npcKeys: string[]): void;
  /** Lines run down whilst unpaused — see `World`'s `onTick` */
  onTick(delta: number): void;
  /** Their bubble as it should be: a line, a debug section, both, or gone */
  sync(npcKey: string): void;
  delete(...npcKeys: string[]): void;
  setShown(npcKey: string, shown: boolean): void;
};
