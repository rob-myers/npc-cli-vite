import { Select } from "@base-ui/react/select";
import { cn, useStateRef } from "@npc-cli/util";
import { CaretDownIcon, PersonSimpleIcon } from "@phosphor-icons/react";
import { type ReactNode, useContext, useEffect } from "react";
import { type ThoughtTag, thoughtConfig } from "../service/thoughts";
import BreathControls from "./BreathControls";
import type { AnimationClipKey } from "./NPCs";
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
      els: new Map(),
      lines: new Map(),
      thoughts: new Map(),

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
      say(npcKey, words, { secs = lineSecsOf(words), hold = false } = {}) {
        if (!(npcKey in w.n)) return;
        state.lines.set(npcKey, { words, secs, held: hold });
        state.sync(npcKey);
      },
      think(npcKey, words, tag) {
        if (!(npcKey in w.n)) return;
        state.thoughts.set(npcKey, { words, tag, secs: thoughtConfig.shownSecs });
        state.sync(npcKey);
      },
      release(...npcKeys) {
        for (const npcKey of npcKeys) {
          const line = state.lines.get(npcKey);
          if (line?.held !== true) continue;
          line.held = false;
          line.secs = lineSecsOf(line.words);
        }
      },
      onTick(delta) {
        for (const [npcKey, line] of state.lines) {
          if (line.held) continue;
          if ((line.secs -= delta) > 0) {
            // written to the DOM, rendering nothing. A new line replaces it at full opacity
            if (line.secs < lineFadeSecs && line.el) line.el.style.opacity = `${line.secs / lineFadeSecs}`;
            continue;
          }
          state.lines.delete(npcKey);
          state.sync(npcKey);
        }
        for (const [npcKey, thought] of state.thoughts) {
          if ((thought.secs -= delta) > 0) continue;
          state.thoughts.delete(npcKey);
          state.sync(npcKey);
        }
        state.syncRoomFades(); // e.g. walked into a room out of view
      },
      syncRoomFades() {
        for (const [npcKey, el] of state.els) {
          const npc = w.n[npcKey];
          if (npc === undefined) continue;
          const lit = npc.npcLit.value * w.view.litNpcsEnabled.value;
          el.style.opacity = `${Math.max(w.view.fadeRoomsFx.visibilityOf(npc.roomSlot.value), lit)}`;
        }
      },
      sync(npcKey) {
        const npc = w.n[npcKey];
        const debug = state.debugs.has(npcKey);
        const line = state.lines.get(npcKey);
        const thought = state.thoughts.get(npcKey);
        if (npc === undefined || (debug === false && line === undefined && thought === undefined)) {
          return w.html.hide(bubbleKey(npcKey));
        }
        w.html.show(
          bubbleKey(npcKey),
          { object: npc.skinnedMesh, offset: npc.bubbleOffset },
          debug ? (
            <NpcBubble w={w} npcKey={npcKey} words={line?.words} />
          ) : (
            <div
              ref={(el) =>
                void (el === null ? state.els.delete(npcKey) : (state.els.set(npcKey, el), state.syncRoomFades()))
              }
              className="flex flex-col items-center"
            >
              {thought !== undefined && <ThoughtBubble words={thought.words} tag={thought.tag} />}
              {line !== undefined && (
                <SaidBubble
                  words={line.words}
                  elRef={(el) => {
                    line.el = el;
                    // the element is reused by the next line said, at its own fade, e.g. none whilst paused
                    if (el !== null) el.style.opacity = `${Math.min(1, line.secs / lineFadeSecs)}`;
                  }}
                />
              )}
            </div>
          ),
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
          state.thoughts.delete(npcKey);
        }
        w.html.hide(...npcKeys.map(bubbleKey));
      },
      setShown(npcKey, shown) {
        w.html.setShown(bubbleKey(npcKey), shown);
      },
    }),
  );

  w.bubble = state;

  useEffect(() => {
    const sub = w.events.subscribe({
      next: (e) => {
        if (isBubbleEvent(e) === false || state.debugs.size === 0) return;
        if ("npcKey" in e) return void (state.debugs.has(e.npcKey) && state.sync(e.npcKey));
        for (const npcKey of e.key === "spawned-many" ? e.npcKeys : state.debugs) {
          if (state.debugs.has(npcKey)) state.sync(npcKey);
        }
      },
    });
    return () => sub.unsubscribe();
  }, []);

  return null;
}

/** Just the line said, click-through */
function SaidBubble({ words, elRef }: { words: string; elRef: (el: HTMLDivElement | null) => void }) {
  return (
    <div
      ref={elRef}
      className="mb-3 w-max max-w-[28rem] rounded-2xl border-2 border-white/30 bg-black/75 px-5 py-2 text-xl text-white/95"
    >
      <Glyphed text={words} />
    </div>
  );
}

/** A thought read off them, click-through: outlined in its khandha's colour, which it names */
function ThoughtBubble({ words, tag }: { words: string; tag: ThoughtTag }) {
  return (
    <div
      className="mb-3 w-max max-w-[28rem] rounded-2xl border-2 border-dashed bg-black/60 px-5 py-2 text-xl italic"
      style={{ borderColor: tag.color, color: tag.color }}
    >
      <div className="text-sm uppercase not-italic opacity-70">{tag.khandha}</div>
      <Glyphed text={words} />
    </div>
  );
}

/** The line said, if any, over what debugging them needs */
function NpcBubble({ w, npcKey, words }: { w: WorldState; npcKey: string; words?: string }) {
  const npc = w.n[npcKey];
  const grKey = w.npc.npcToRoom.get(npcKey)?.grKey;

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
          value={npc.anim.pose}
          onValueChange={(next) => {
            if (next === null || w.n[npcKey] === undefined) return;
            w.n[npcKey].anim.setHurt(null); // else they go back to it
            w.n[npcKey].anim.setPose(next);
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
      <div className="flex flex-wrap gap-2">
        {(["psi", "phaser"] as const).map((name) => {
          const had = w.e.hasItem(npcKey, name);
          return (
            <ToggleButton
              key={name}
              on={had}
              title={`${had ? "take away" : "give"} ${name}`}
              onClick={() => {
                had ? w.e.revokeItem(npcKey, name) : w.e.giveItem(npcKey, name);
                w.bubble.sync(npcKey); // a gift is not announced
              }}
            >
              {name}
            </ToggleButton>
          );
        })}
        {npc !== undefined && (
          <ToggleButton
            on={npc.anim.breath.on}
            title={`${npc.anim.breath.on ? "stop" : "start"} breathing`}
            onClick={() => npc.anim.setBreathing(!npc.anim.breath.on)}
          >
            breath
          </ToggleButton>
        )}
        {npc !== undefined && npcKey !== w.player?.key && (
          <ToggleButton on={npc.lit} onClick={() => w.e.setNpcLit(npc)}>
            lit
          </ToggleButton>
        )}
        {/* the speech menu's added items e.g. picked */}
        {w.speech.menuItems.map((item) => (
          <ToggleButton key={item.key} on={item.on?.(npcKey)} onClick={() => item.action(npcKey)}>
            {item.text}
          </ToggleButton>
        ))}
      </div>
      {npcKey === w.player?.key && <BreathControls w={w} />}
    </div>
  );
}

/** A bubble's button: amber whilst `on`, dim whilst off, plain if neither */
function ToggleButton({ on, ...props }: { on?: boolean; title?: string; onClick(): void; children: ReactNode }) {
  const look =
    on === undefined
      ? "border-white/20 text-white/60"
      : on
        ? "border-amber-300/60 text-amber-200"
        : "border-white/20 text-white/40";
  return <button type="button" className={cn("cursor-pointer rounded-lg border-2 px-3 py-0.5", look)} {...props} />;
}

const bubbleKey = (npcKey: string) => `bubble:${npcKey}`;
/** Events that may change a debug section: their room, pose, what they carry, a toggle e.g. lit. Most name the npc */
const bubbleEvents = new Set([
  "carried",
  "enter-room",
  "npc-posed",
  "npc-toggled",
  "spawned",
  "spawned-many",
  "nav-updated", // e.g. after a map edit: every room is recomputed
  "requested-physics",
] as const) satisfies Set<JshCli.Event["key"]>;

/** `e` is one of `bubbleEvents`, narrowed to them */
function isBubbleEvent(
  e: JshCli.Event,
): e is Extract<JshCli.Event, { key: typeof bubbleEvents extends Set<infer K> ? K : never }> {
  return (bubbleEvents as ReadonlySet<string>).has(e.key);
}
/** Seconds a line said stays over them, whilst unpaused: long enough to be found, then read, word by word */
const lineSecsOf = (words: string) =>
  Math.min(lineConfig.minSecs + lineConfig.wordSecs * words.trim().split(/\s+/).length, lineConfig.maxSecs);
const lineConfig = { minSecs: 2, wordSecs: 0.4, maxSecs: 10 };
/** Its last seconds, in which it fades out */
const lineFadeSecs = 1;

export type State = {
  /** Whose debug section is open */
  debugs: Set<string>;
  /** Each bubble bar a debug section, by npcKey, faded with their room */
  els: Map<string, HTMLDivElement>;
  /** The line each said last, and the seconds it has left — none whilst `held` */
  lines: Map<string, { words: string; secs: number; held: boolean; el?: HTMLDivElement | null }>;
  /** The thought last read off each, and the seconds it has left */
  thoughts: Map<string, { words: string; tag: ThoughtTag; secs: number }>;
  /** Opens their debug section — `focus` its close button, open already or not */
  openDebug(npcKey: string, opts?: { focus?: boolean }): void;
  toggleDebug(npcKey: string): void;
  closeDebug(npcKey: string): void;
  /** Over them for `secs`, replacing what they said before — or until released, when `hold` */
  say(npcKey: string, words: string, opts?: { secs?: number; hold?: boolean }): void;
  /** Over them as a thought, above anything they are saying, for `thoughtConfig.shownSecs` */
  think(npcKey: string, words: string, tag: ThoughtTag): void;
  /** A held line starts its `lineSecsOf`, e.g. once answered */
  release(...npcKeys: string[]): void;
  /** Lines run down whilst unpaused — see `World`'s `onTick` */
  onTick(delta: number): void;
  /** Each bubble's opacity is their body's: their room's fade, unless they are lit. Written to the DOM */
  syncRoomFades(): void;
  /** Their bubble as it should be: a line, a debug section, both, or gone */
  sync(npcKey: string): void;
  delete(...npcKeys: string[]): void;
  setShown(npcKey: string, shown: boolean): void;
};
