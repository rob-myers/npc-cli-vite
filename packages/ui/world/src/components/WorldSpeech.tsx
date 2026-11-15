import { Menu } from "@base-ui/react/menu";
import { cn, useStateRef } from "@npc-cli/util";
import { CaretDownIcon, CaretRightIcon, ChatCircleTextIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useDragControls, useMotionValue } from "motion/react";
import { type ReactNode, useContext, useEffect, useState } from "react";
import { npcDims } from "../const.both";
import { psiKhandhas } from "../const.npc";

import { getWorldStore } from "../service/storage";
import { type TalkChoice, threadKeyOf } from "../service/talk";
import { demoThoughts, type ThoughtTag } from "../service/thoughts";
import { NetBadge, NetMenu } from "./NetMenu";
import { type TalkLine, type TalkPip, TalkThread } from "./TalkThread";
import { WorldContext } from "./world-context";

export function WorldSpeech() {
  const w = useContext(WorldContext);
  /** Bigger touch targets on mobile */
  const big = w.touchDevice;

  const store = getWorldStore(w.key);
  const saved = store.read();

  const state = useStateRef(
    (): State => ({
      dragged: false,
      panelOpen: false,
      panelTab: "comms",
      history: [],
      menuItems: [],
      minY: 40,
      nextId: 0,
      thoughtAt: 0,
      unread: false,
      y: saved.speechY,
      historyHeight: saved.speechHeight ?? (big ? 384 : 288),
      historyWidth: saved.speechWidth ?? (big ? 320 : 288),
      resizing: false,
      talks: {},
      folded: new Set(),
      needDefs: new Map(),
      needsMet: new Map(),

      addMenuItem(item) {
        // keyed, so a command re-run (or its hot-reload) replaces its item rather than doubling it
        const index = state.menuItems.findIndex((x) => x.key === item.key);
        if (index === -1) state.menuItems.push(item);
        else state.menuItems[index] = item;
        state.update();
      },
      removeMenuItem(key) {
        state.menuItems = state.menuItems.filter((x) => x.key !== key);
        state.update();
      },
      toggleFold(threadKey) {
        if (state.folded.delete(threadKey) === false) state.folded.add(threadKey);
        state.update();
      },
      clear() {
        for (const talk of Object.values(state.talks)) w.bubble.release(talk.npcKey, talk.toKey);
        state.history = [];
        state.talks = {};
        state.needsMet.clear();
        state.folded.clear();
        state.update();
      },
      clearThread(threadKey) {
        const parties = new Set<string>();
        state.history = state.history.filter((entry) => {
          const theirs = entry.parties ?? [entry.npcKey];
          if (threadKeyOf(theirs) !== threadKey) return true;
          for (const npcKey of theirs) parties.add(npcKey);
          return false;
        });
        delete state.talks[threadKey];
        state.needsMet.delete(threadKey);
        state.folded.delete(threadKey);
        w.bubble.release(...parties); // a line held for an answer has none coming
        state.update();
      },
      clearEntries(ids) {
        const gone = new Set(ids);
        state.history = state.history.filter((entry) => gone.has(entry.id) === false);
        state.update();
      },
      ask(npcKey, toKey, text, replies, opts) {
        const threadKey = threadKeyOf([npcKey, toKey]);
        state.talks[threadKey] = { npcKey, toKey, replies, topic: opts?.topic, ended: false };
        state.needsMet.delete(threadKey);
        if (toKey === w.player?.key) state.set({ panelOpen: true, panelTab: "comms" });
        state.say(npcKey, text, undefined, { to: [toKey], hold: replies.length > 0, topic: opts?.topic });
        const keys = replies.map((choice) => choice.key);
        w.events.next({ key: "talk-ask", threadKey, npcKey, to: toKey, text, replies: keys });
      },
      bye(npcKey, toKey) {
        const threadKey = threadKeyOf([npcKey, toKey]);
        const topic = state.talks[threadKey]?.topic;
        state.talks[threadKey] = { npcKey, toKey, replies: [], topic, ended: true };
        state.needsMet.delete(threadKey);
        w.bubble?.release(npcKey, toKey);
        state.update();
        w.events.next({ key: "talk-bye", threadKey, npcKey, to: toKey });
      },
      reply(threadKey, key) {
        const talk = state.talks[threadKey];
        const choice = talk?.replies.find((x) => x.key === key);
        if (talk === undefined || choice === undefined) return false;
        talk.replies = [];
        const { npcKey, toKey } = talk;
        state.say(toKey, choice.text, undefined, { to: [npcKey] });
        w.events.next({ key: "talk-reply", threadKey, npcKey: toKey, to: npcKey, choice: key });
        return true;
      },
      tell(npcKey, toKey, text) {
        const threadKey = threadKeyOf([npcKey, toKey]);
        const talk = state.talks[threadKey];
        if (talk !== undefined) talk.replies = [];
        state.say(npcKey, text, undefined, { to: [toKey] });
        w.events.next({ key: "talk-tell", threadKey, npcKey, to: toKey, text });
      },
      defineNeeds(defs) {
        for (const [key, def] of Object.entries(defs)) state.needDefs.set(key, def);
        state.update();
      },
      removeNeeds(keys) {
        for (const key of keys) state.needDefs.delete(key);
        state.update();
      },
      setMet(byThread) {
        let changed = false;
        for (const [threadKey, met] of Object.entries(byThread)) {
          const was = state.needsMet.get(threadKey);
          if (was !== undefined && was.size === met.length && met.every((need) => was.has(need))) continue;
          state.needsMet.set(threadKey, new Set(met));
          changed = true;
        }
        changed && state.update();
      },
      getPips(threadKey, choice) {
        const met = state.needsMet.get(threadKey);
        return (choice.needs ?? []).map((need) => {
          const def = state.needDefs.get(need);
          // undefined until defined, e.g. by jsh `comms`: then never met
          return { label: def?.label ?? need, icon: def?.icon, met: def !== undefined && met?.has(need) === true };
        });
      },
      getMaxY() {
        return Math.max(state.minY, (w.rootEl?.clientHeight ?? Infinity) - 120);
      },
      getClampedY(y: number) {
        return Math.min(state.getMaxY(), Math.max(state.minY, y));
      },
      getMaxHistoryHeight() {
        return Math.max(minHistoryHeight, (w.rootEl?.clientHeight ?? Infinity) - 160);
      },
      getClampedHistoryHeight(height: number) {
        return Math.min(state.getMaxHistoryHeight(), Math.max(minHistoryHeight, height));
      },
      getMaxHistoryWidth() {
        return Math.max(minHistoryWidth, (w.rootEl?.clientWidth ?? Infinity) - 32);
      },
      getClampedHistoryWidth(width: number) {
        return Math.min(state.getMaxHistoryWidth(), Math.max(minHistoryWidth, width));
      },
      onResize() {
        y.set(state.getClampedY(y.get()));
        state.historyHeight = state.getClampedHistoryHeight(state.historyHeight);
        state.historyWidth = state.getClampedHistoryWidth(state.historyWidth);
        state.update();
      },
      onResizeDown(e, edge) {
        e.stopPropagation();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId); // so the drag is ours wherever it goes
        const from = {
          x: e.clientX,
          y: e.clientY,
          width: state.historyWidth,
          height: state.historyHeight,
          top: y.get(),
        };
        state.resizing = true;

        const onMove = (ev: PointerEvent) => {
          const dx = ev.clientX - from.x;
          const dy = ev.clientY - from.y;
          // the panel is right-anchored, so a drag left widens it
          if (edge !== "top" && edge !== "bottom") state.historyWidth = state.getClampedHistoryWidth(from.width - dx);
          if (edge !== "top" && edge !== "left") state.historyHeight = state.getClampedHistoryHeight(from.height + dy);
          if (edge === "top") {
            // its foot stays put: it moves by as much as it shortens
            state.historyHeight = state.getClampedHistoryHeight(
              from.height - (state.getClampedY(from.top + dy) - from.top),
            );
            y.set(from.top + from.height - state.historyHeight);
          }
          state.update();
        };
        const onUp = () => {
          state.resizing = false;
          state.persistHistorySize();
          state.persistY();
          el.removeEventListener("pointermove", onMove);
        };
        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerup", onUp, { once: true });
        el.addEventListener("pointercancel", onUp, { once: true });
      },
      persistY() {
        store.patch({ speechY: state.getClampedY(y.get()) });
      },
      persistHistorySize() {
        store.patch({ speechHeight: state.historyHeight, speechWidth: state.historyWidth });
      },
      say(npcKey, words, secs, opts) {
        const epochMs = Date.now();
        const to = opts?.to;
        // those addressed have been answered, so their lines may go
        if (to !== undefined) w.bubble?.release(...to);
        const parties = [npcKey, ...(to ?? [])];
        const entry: SpeechEntry = { id: state.nextId++, npcKey, words, epochMs, parties, topic: opts?.topic };

        state.history.push(entry);
        if (state.history.length > maxHistory) state.history.shift();

        // unseen, with the history shut: the button says so
        if (state.panelOpen === false || state.panelTab !== "comms") state.unread = true;
        state.update();

        // over their head
        w.bubble?.say(npcKey, words, { secs, hold: opts?.hold });

        w.events.next({ key: "speech", npcKey, words, epochMs, to });
      },
      readThought(npcKey) {
        if (w.n?.[npcKey] === undefined) return;
        const { khandha, text } = demoThoughts[state.thoughtAt++ % demoThoughts.length];
        state.think(npcKey, text, { khandha, color: psiKhandhas[khandha].color });
      },
      think(npcKey, words, tag) {
        const playerKey = w.player?.key;
        // in their thread with the player, who alone reads it: no event, so no client hears of it
        const parties = playerKey === undefined ? [npcKey] : [npcKey, playerKey];
        state.history.push({ id: state.nextId++, npcKey, words, epochMs: Date.now(), parties, thought: tag });
        if (state.history.length > maxHistory) state.history.shift();
        if (state.panelOpen === false || state.panelTab !== "comms") state.unread = true;
        state.update();
        w.bubble?.think(npcKey, words, tag);
      },
    }),
  );

  w.speech = state;

  useEffect(() => {
    // joining a world is done from the panel — once connected, it gets out of the way
    const sub = w.events.subscribe({
      next: (e) => {
        if (e.key === "net-changed" && e.mode === "client" && e.phase === "connected") {
          state.set({ panelOpen: false });
        }
        if (e.key === "npc-toggled") state.update(); // their menu shows it
      },
    });
    return () => sub.unsubscribe();
  }, []);

  // seen, once the history is open on what was said
  const unread = state.unread && (state.panelOpen === false || state.panelTab !== "comms");
  if (unread === false) state.unread = false;

  const y = useMotionValue(state.getClampedY(state.y));
  const dragControls = useDragControls();

  return (
    <>
      {/* history toggle — only the icon starts a drag, so scrolling the panel below never fights it */}
      <motion.div
        // click-through, bar what is in it
        className="absolute top-0 right-px z-10 select-none flex flex-col items-end pointer-events-none"
        style={{ y }}
        drag="y"
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: state.minY, bottom: state.getMaxY() }}
        dragMomentum={false}
        onDragStart={() => (state.dragged = true)}
        onDragEnd={() => {
          state.persistY();
          requestAnimationFrame(() => (state.dragged = false));
        }}
      >
        <div
          className={cn(
            "relative pointer-events-auto outline-width-1 grid touch-none place-items-center cursor-pointer bg-neutral-800 text-white hover:bg-neutral-700",
            big ? "size-12" : "size-9",
          )}
          onPointerDown={(e) => dragControls.start(e)}
          onClick={() => {
            if (state.dragged) return;
            state.set({ panelOpen: !state.panelOpen });
          }}
        >
          <ChatCircleTextIcon className={big ? "size-6" : "size-5"} weight="bold" />
          <NetBadge />
          {unread && (
            <span className="absolute bottom-0.5 left-0.5 size-2 rounded-full bg-sky-300 pointer-events-none" />
          )}
        </div>

        <AnimatePresence>
          {state.panelOpen && (
            <motion.div
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.15 }}
              className={cn(
                // see-through, the World behind it softened: what is said keeps its own ground
                "relative pointer-events-auto mt-1 flex flex-col backdrop-blur-xs border border-slate-700/70 rounded-md shadow-lg py-1",
                // a pale World would wash its pale ink out
                w.themeKey === "light-theme" ? "bg-slate-800/90" : "bg-slate-800/45",
                big && "py-2",
              )}
              style={{ width: state.historyWidth }}
            >
              <div
                className={cn("flex items-center gap-3 px-2 py-1 text-xs text-slate-300", big && "px-3 py-2 text-sm")}
              >
                {speechPanelTabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={cn(
                      "cursor-pointer",
                      state.panelTab === tab
                        ? "text-slate-100 underline underline-offset-4"
                        : "text-slate-500 hover:text-slate-300",
                    )}
                    onClick={() => state.set({ panelTab: tab })}
                  >
                    {tab}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-2">
                  {state.panelTab === "comms" && (
                    <TrashIcon
                      className={cn("size-4 cursor-pointer text-slate-500 hover:text-red-300", big && "size-5")}
                      onClick={() => state.clear()}
                    />
                  )}
                  <XIcon
                    className={cn("size-4 cursor-pointer text-slate-500 hover:text-slate-300", big && "size-5")}
                    onClick={() => state.set({ panelOpen: false })}
                  />
                </div>
              </div>

              {state.panelTab === "worlds" && <NetMenu />}

              {state.panelTab === "comms" && (
                <div
                  // its own ink: the panel is dark in either theme
                  className={cn(
                    "flex flex-col gap-3 px-2 pb-2 overflow-y-auto scrollbar-thin text-xs text-slate-300",
                    big && "text-sm",
                  )}
                  style={{ height: state.historyHeight }}
                >
                  {state.history.length === 0 && (
                    <div className="px-1 py-2 text-slate-500 italic">nothing said yet</div>
                  )}
                  {toThreads(state.history).map((thread) => (
                    <SpeechThread key={thread.key} thread={thread} />
                  ))}
                </div>
              )}

              {/* drag a side to move it alone: each clear of the corner, which sets two */}
              {resizeEdges.map(([edge, className]) => (
                <div
                  key={edge}
                  className={cn("absolute touch-none", className)}
                  onPointerDown={(e) => state.onResizeDown(e, edge)}
                />
              ))}

              {/* drag to resize the panel — bottom-left corner, since the panel is right-anchored */}
              <div
                className="absolute bottom-0 left-0 size-5 touch-none cursor-nesw-resize"
                onPointerDown={(e) => state.onResizeDown(e, "corner")}
              >
                <div
                  className={cn(
                    "absolute bottom-1 left-1 size-2.5 border-b-2 border-l-2 border-slate-600 rounded-bl",
                    state.resizing && "border-slate-400",
                  )}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  );
}

/** The history by who spoke in it and to whom, the latest spoken in first */
function toThreads(history: SpeechEntry[]) {
  const byKey = new Map<string, Thread>();
  for (const entry of history) {
    const parties = entry.parties ?? [entry.npcKey];
    const key = threadKeyOf(parties);
    const thread = byKey.get(key) ?? { key, parties: [...new Set(parties)].sort(), entries: [] };
    thread.entries.push(entry);
    byKey.set(key, thread);
  }
  return [...byKey.values()].sort((a, b) => (b.entries.at(-1)?.id ?? 0) - (a.entries.at(-1)?.id ?? 0));
}

/** What of the panel a drag moves: the right side is anchored */
type ResizeEdge = "top" | "left" | "bottom" | "corner";

const resizeEdges: [ResizeEdge, string][] = [
  ["top", "top-0 inset-x-0 h-1.5 cursor-ns-resize"],
  ["left", "left-0 top-0 bottom-5 w-1.5 cursor-ew-resize"],
  ["bottom", "bottom-0 left-5 right-0 h-1.5 cursor-ns-resize"],
];

/** One thread of the history, and should it be a talk with the player, their replies */
function SpeechThread({ thread }: { thread: Thread }) {
  const w = useContext(WorldContext);
  const talk = w.speech.talks[thread.key] as Talk | undefined;
  const playerKey = w.player?.key;
  const lastId = thread.entries.at(-1)?.id;
  /** Whoever of the two has been removed */
  const goneKey = talk === undefined ? undefined : [talk.npcKey, talk.toKey].find((key) => !(key in w.n));
  const folded = w.speech.folded.has(thread.key);
  const Caret = folded ? CaretRightIcon : CaretDownIcon;

  const lines = thread.entries.map(
    (entry): TalkLine => ({
      id: entry.id,
      // the player's on the right; between npcs, the first of them on the left
      side:
        entry.npcKey === (playerKey !== undefined && thread.parties.includes(playerKey) ? playerKey : thread.parties[1])
          ? "right"
          : "left",
      text: entry.words,
      thought: entry.thought,
      topic: entry.topic,
      who: thread.parties.length > 2 ? entry.npcKey : undefined,
    }),
  );
  const replies =
    talk === undefined || goneKey !== undefined || talk.toKey !== playerKey
      ? []
      : talk.replies.map((choice) => ({
          text: choice.text,
          pips: w.speech.getPips(thread.key, choice),
          onChoose: () => {
            const pips = w.speech.getPips(thread.key, choice);
            if (pips.every((pip) => pip.met !== false)) w.speech.reply(thread.key, choice.key);
          },
        }));

  return (
    <div className="flex flex-col gap-1 border-t border-slate-700 pt-1 first:border-t-0">
      <div className="flex flex-wrap items-center text-slate-500">
        <Caret
          weight="bold"
          className="size-3 shrink-0 cursor-pointer hover:text-slate-300"
          onClick={() => w.speech.toggleFold(thread.key)}
        >
          <title>{folded ? "unfold this conversation" : "fold this conversation"}</title>
        </Caret>
        {thread.parties.map((npcKey, i) => (
          <span key={npcKey} className="flex items-center">
            {i > 0 && "·"}
            <NpcKeyMenu npcKey={npcKey} className="px-1 text-xs" />
          </span>
        ))}
        {folded && <span className="pl-1 text-[10px]">{thread.entries.length}</span>}
        <XIcon
          className="ml-auto size-3.5 shrink-0 cursor-pointer text-slate-600 hover:text-red-300"
          onClick={() => w.speech.clearThread(thread.key)}
        >
          <title>clear this conversation</title>
        </XIcon>
      </div>
      {folded === false && (
        <TalkThread
          lines={lines}
          replies={replies}
          repliesKey={`${lastId}`}
          onClear={(ids) => w.speech.clearEntries(ids)}
          footer={
            goneKey !== undefined ? (
              <div className="self-center text-slate-500 italic">{goneKey} is gone</div>
            ) : (
              talk?.ended === true && <div className="self-center text-slate-500 italic">the end</div>
            )
          }
        />
      )}
    </div>
  );
}

/**
 * The npc's key, as a menu: it is the only handle onto an npc the speech UI has, so what you can do
 * to them hangs off it
 */
function NpcKeyMenu({ npcKey, className }: { npcKey: string; className?: string }) {
  const w = useContext(WorldContext);
  /** `remove` is armed by its first click and takes effect on the second, in the same place */
  const [armed, setArmed] = useState(false);
  const [open, setOpen] = useState(false);

  const npc = w.n[npcKey];
  // `setNpcLit` refuses the player, so the item would silently do nothing for them
  const canLightOrDelete = npc !== undefined && npc.key !== w.player?.key;

  return (
    <Menu.Root
      open={open}
      // a press outside, e.g. on the World, lands there and leaves it open: the trigger, Escape or an item closes it
      modal={false}
      onOpenChange={(next, { reason }) => {
        if (next === false && reason === "outside-press") return;
        setArmed(false);
        setOpen(next);
      }}
    >
      <Menu.Trigger
        className={cn(
          "pointer-events-auto shrink-0 px-3 inline-flex items-center gap-1 font-medium tracking-wider text-blue-200/80 cursor-pointer hover:text-sky-200 data-popup-open:text-sky-100",

          npc?.lit === true && "text-yellow-200/80",
          className,
        )}
      >
        {npcKey}
      </Menu.Trigger>
      <Menu.Portal container={w.rootEl}>
        <Menu.Positioner className="z-50" side="bottom" align="start" sideOffset={8}>
          <Menu.Popup className="select-none bg-slate-800 border border-slate-700 rounded-md shadow-lg min-w-18">
            {npc !== undefined && (
              <Menu.Item
                className={speechMenuItemClassName}
                closeOnClick={false}
                onClick={() => w.pickMenu.toggle({ npcKey })}
              >
                debug
              </Menu.Item>
            )}
            {npc !== undefined && (
              <Menu.Item
                className={speechMenuItemClassName}
                closeOnClick={false}
                // tracked, since they may walk whilst it pans — and it animates on its own frames,
                // so it works with the world paused. See `lookAtPlayer`, which does the same
                onClick={() =>
                  void w.view.lookAt(npc.point, {
                    animate: true,
                    height: npcDims.height,
                    track: () => w.n[npcKey]?.point,
                  })
                }
              >
                goto
              </Menu.Item>
            )}
            {canLightOrDelete === true && (
              <Menu.Item className={speechMenuItemClassName} closeOnClick={false} onClick={() => w.e.setNpcLit(npc)}>
                <MenuToggle on={npc.lit === true}>lit</MenuToggle>
              </Menu.Item>
            )}
            {canLightOrDelete === true && (
              <Menu.Item
                className={speechMenuItemClassName}
                closeOnClick={false}
                onClick={() => w.npcFocus.setLaser(npcKey)}
              >
                <MenuToggle on={w.npcFocus.lasers.has(npcKey)}>laser</MenuToggle>
              </Menu.Item>
            )}
            {canLightOrDelete && (
              <Menu.Item
                className={cn(speechMenuItemClassName, armed === true && "text-red-300 data-highlighted:text-red-200")}
                // "confirm" replaces it where it already is, then closes: the npc goes with it
                closeOnClick={armed}
                onClick={() => (armed === true ? w.e.removeNpcs(npcKey) : setArmed(true))}
              >
                {armed === true ? "confirm" : "remove"}
              </Menu.Item>
            )}
            {w.speech.menuItems.map((item) => (
              <Menu.Item
                key={item.key}
                className={speechMenuItemClassName}
                closeOnClick={false}
                onClick={() => item.action(npcKey)}
              >
                {item.on === undefined ? item.text : <MenuToggle on={item.on(npcKey)}>{item.text}</MenuToggle>}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** A menu item's text, amber whilst `on` */
function MenuToggle({ on, children }: { on: boolean; children: ReactNode }) {
  return <span className={cn(on && "text-amber-200")}>{children}</span>;
}

const speechMenuItemClassName =
  "px-3 py-1.5 text-xs cursor-pointer text-slate-300 data-highlighted:bg-slate-700 data-highlighted:text-slate-100";

export type SpeechEntry = {
  id: number;
  npcKey: string;
  words: string;
  epochMs: number;
  /** Who said it, and to whom: its thread */
  parties?: string[];
  /** Its ask's topic, e.g. jsh `ask … topic:guard` */
  topic?: string;
  /** Thought, not said: read by psi */
  thought?: ThoughtTag;
};

/** The talk in a thread of two: its last ask, and the replies still open */
export type Talk = {
  /** Who asked last */
  npcKey: string;
  /** Who was asked: the player, unless jsh `ask npc:…` */
  toKey: string;
  /** Open until one is said, or the next line in the thread */
  replies: TalkChoice[];
  topic?: string;
  /** By `bye`, until the next ask */
  ended: boolean;
};

type Thread = { key: string; parties: string[]; entries: SpeechEntry[] };

/** An item added to every `NpcKeyMenu` by e.g. a jsh command — see `addMenuItem` */
export type SpeechMenuItem = {
  key: string;
  text: string;
  /** A toggle, shown on for this npc, e.g. picked. Its `action` emits `npc-toggled`, so the menus show the change */
  on?(npcKey: string): boolean;
  action(npcKey: string): void;
};

export type State = {
  dragged: boolean;
  panelOpen: boolean;
  panelTab: (typeof speechPanelTabs)[number];
  history: SpeechEntry[];
  menuItems: SpeechMenuItem[];
  minY: number;
  nextId: number;
  /** Something was said since the history was last open on it */
  unread: boolean;
  y: number;
  /** Height (px) of the scrollable history list — resizable, persisted */
  historyHeight: number;
  /** Width (px) of the whole history panel — resizable, persisted */
  historyWidth: number;
  resizing: boolean;
  /** By `threadKeyOf` the two */
  talks: Record<string, Talk>;
  /** Threads shown as their heading alone, by key */
  folded: Set<string>;
  /** What a reply's need is called, by key — defined by e.g. jsh `comms` */
  needDefs: Map<string, NeedDef>;
  /** The needs met, by thread — set by e.g. jsh `comms` */
  needsMet: Map<string, Set<string>>;
  addMenuItem(item: SpeechMenuItem): void;
  removeMenuItem(key: string): void;
  clear(): void;
  /** Some lines of the history, e.g. a talk's run about one topic — the talk carries on */
  clearEntries(ids: number[]): void;
  /** One thread's history, and its talk — two parties, one, or a group's */
  clearThread(threadKey: string): void;
  toggleFold(threadKey: string): void;
  getMaxY(): number;
  getClampedY(y: number): number;
  getMaxHistoryHeight(): number;
  getClampedHistoryHeight(height: number): number;
  getMaxHistoryWidth(): number;
  getClampedHistoryWidth(width: number): number;
  onResize(): void;
  /** A drag of `edge` resizes the panel until it is let go */
  onResizeDown(e: React.PointerEvent<HTMLElement>, edge: ResizeEdge): void;
  persistY(): void;
  persistHistorySize(): void;
  /** Into the history, and over their head for `secs` — or, on `hold`, until someone it addresses answers */
  say(npcKey: string, words: string, secs?: number, opts?: { to?: string[]; topic?: string; hold?: boolean }): void;
  /** Which of `demoThoughts` is next */
  thoughtAt: number;
  /** Reads their next thought, as psi does — see `docs/psi.md` */
  readThought(npcKey: string): void;
  /** Into the history as a thought of theirs, and over their head */
  think(npcKey: string, words: string, tag: ThoughtTag): void;
  /** `npcKey` asks `toKey`, held over their head until replied to. Emits `talk-ask` */
  ask(npcKey: string, toKey: string, text: string, replies: TalkChoice[], opts?: { topic?: string }): void;
  /** Ends the talk of the two. Emits `talk-bye` */
  bye(npcKey: string, toKey: string): void;
  /** The one asked says reply `key` to the asker. False if it is not open. Emits `talk-reply` */
  reply(threadKey: string, key: string): boolean;
  /** `npcKey` tells `toKey`, closing any open ask of the two. Emits `talk-tell` */
  tell(npcKey: string, toKey: string, text: string): void;
  /** A reply's needs, as pips */
  getPips(threadKey: string, choice: TalkChoice): TalkPip[];
  defineNeeds(defs: Record<string, NeedDef>): void;
  removeNeeds(keys: string[]): void;
  /** The needs now met, by thread: only a change re-renders */
  setMet(byThread: Record<string, string[]>): void;
};

export type NeedDef = { label: string; icon?: string };

const speechPanelTabs = ["worlds", "comms"] as const;

const minHistoryHeight = 120;
const minHistoryWidth = 200;
const maxHistory = 200;
