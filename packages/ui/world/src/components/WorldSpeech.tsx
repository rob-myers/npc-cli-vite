import { Menu } from "@base-ui/react/menu";
import { cn, useStateRef } from "@npc-cli/util";
import { ChatCircleTextIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useDragControls, useMotionValue } from "motion/react";
import { useContext, useEffect, useState } from "react";
import { npcDims } from "../const.both";

import { getWorldStore } from "../service/storage";
import { type Conversation, type ConversationChoice, talkNeeds, threadKeyOf } from "../service/talk";
import type { ThoughtTag } from "../service/thoughts";
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
      panelTab: "speech",
      history: [],
      menuItems: [],
      minY: 40,
      nextId: 0,
      unread: false,
      y: saved.speechY,
      historyHeight: saved.speechHeight ?? (big ? 384 : 288),
      historyWidth: saved.speechWidth ?? (big ? 320 : 288),
      resizing: false,
      talks: {},
      needsSig: "",
      needsSecs: 0,

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
      clear() {
        for (const talk of Object.values(state.talks)) w.bubble.release(talk.npcKey, talk.playerKey);
        state.history = [];
        state.talks = {};
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
        w.bubble.release(...parties); // a line held for an answer has none coming
        state.update();
      },
      clearEntries(ids) {
        const gone = new Set(ids);
        state.history = state.history.filter((entry) => gone.has(entry.id) === false);
        state.update();
      },
      startTalk(conv, npcKey) {
        const playerKey = w.player?.key;
        if (playerKey === undefined || playerKey === npcKey || !(playerKey in w.n) || !(npcKey in w.n)) return false;
        const at = conv.start;
        state.talks[threadKeyOf([playerKey, npcKey])] = {
          conv,
          npcKey,
          playerKey,
          at,
          answer: null,
          seen: new Set([at]),
        };
        state.set({ panelOpen: true, panelTab: "speech" });
        const hold = (conv.nodes[at]?.choices?.length ?? 0) > 0;
        state.say(npcKey, conv.nodes[at]?.text ?? "…", undefined, { to: [playerKey], nodeId: at, hold });
        return true;
      },
      chooseTalk(threadKey, index) {
        const talk = state.talks[threadKey];
        const choice = talk?.conv.nodes[talk.at]?.choices?.[index];
        if (talk === undefined || choice === undefined || talk.answer !== null) return;
        if (state.getPips(talk, choice).some((pip) => pip.met === false)) return;
        // they take a moment to answer, in world time — see `onTick`
        talk.answer = { nodeId: choice.to, secs: answerSecs };
        state.say(talk.playerKey, choice.text, undefined, { to: [talk.npcKey], hold: true });
      },
      answerTalk(threadKey) {
        const talk = state.talks[threadKey];
        if (talk?.answer === undefined || talk.answer === null) return;
        const { nodeId } = talk.answer;
        talk.answer = null;
        const next = talk.conv.nodes[nodeId];
        // they may be gone by then
        if (next === undefined || !(talk.npcKey in w.n)) return state.update();
        talk.at = nodeId;
        talk.seen.add(nodeId);
        const hold = (next.choices?.length ?? 0) > 0;
        state.say(talk.npcKey, next.text, undefined, { to: [talk.playerKey], nodeId, hold });
      },
      revisitTalk(threadKey, entryId) {
        const talk = state.talks[threadKey];
        const nodeId = state.history.find((entry) => entry.id === entryId)?.nodeId;
        const node = nodeId === undefined ? undefined : talk?.conv.nodes[nodeId];
        if (talk === undefined || nodeId === undefined || node === undefined || talk.answer !== null) return;
        if (!(talk.npcKey in w.n)) return;
        // said again, at the foot: what was said since stays as it was
        talk.at = nodeId;
        const hold = (node.choices?.length ?? 0) > 0;
        state.say(talk.npcKey, node.text, undefined, { to: [talk.playerKey], nodeId, hold });
      },
      getPips(talk, choice) {
        const player = w.n[talk.playerKey];
        const npc = w.n[talk.npcKey];
        // nobody to talk to, or someone else is the player now
        const able = player !== undefined && npc !== undefined && w.player?.key === talk.playerKey;
        return (choice.needs ?? []).map((need) => ({
          label: talkNeeds[need].label,
          met: able && talkNeeds[need].met(w, player, npc),
        }));
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
      onResizeMouseDown(e, heightOnly = false) {
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = state.historyWidth;
        const startHeight = state.historyHeight;
        state.resizing = true;
        const onMove = (ev: MouseEvent) => {
          // panel is right-anchored, so dragging the corner left (negative dx) widens it
          if (heightOnly === false)
            state.historyWidth = state.getClampedHistoryWidth(startWidth - (ev.clientX - startX));
          state.historyHeight = state.getClampedHistoryHeight(startHeight + (ev.clientY - startY));
          state.update();
        };
        const onUp = () => {
          state.resizing = false;
          state.persistHistorySize();
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      },
      onResizeTouchStart(e, heightOnly = false) {
        e.stopPropagation();
        const t = e.touches[0];
        if (!t) return;
        const startX = t.clientX;
        const startY = t.clientY;
        const startWidth = state.historyWidth;
        const startHeight = state.historyHeight;
        state.resizing = true;
        const onMove = (ev: TouchEvent) => {
          const t2 = ev.touches[0];
          if (t2) {
            if (heightOnly === false)
              state.historyWidth = state.getClampedHistoryWidth(startWidth - (t2.clientX - startX));
            state.historyHeight = state.getClampedHistoryHeight(startHeight + (t2.clientY - startY));
            state.update();
          }
        };
        const onEnd = () => {
          state.resizing = false;
          state.persistHistorySize();
          document.removeEventListener("touchmove", onMove, { capture: true });
          document.removeEventListener("touchend", onEnd, { capture: true });
        };
        document.addEventListener("touchmove", onMove, { capture: true });
        document.addEventListener("touchend", onEnd, { capture: true });
      },
      persistY() {
        store.patch({ speechY: state.getClampedY(y.get()) });
      },
      persistHistorySize() {
        store.patch({ speechHeight: state.historyHeight, speechWidth: state.historyWidth });
      },
      onTick(delta) {
        // only whilst the world is unpaused (see `World`), so nobody answers during a pause
        for (const [threadKey, talk] of Object.entries(state.talks)) {
          if (talk.answer !== null && (talk.answer.secs -= delta) <= 0) state.answerTalk(threadKey);
        }

        // a reply's pips follow the player about, so are looked at again now and then
        if (state.panelOpen === false || (state.needsSecs -= delta) > 0) return;
        state.needsSecs = needsPollSecs;
        const needsSig = Object.values(state.talks)
          .flatMap((talk) => (talk.conv.nodes[talk.at]?.choices ?? []).map((c) => state.getPips(talk, c)))
          .map((pips) => pips.map((pip) => Number(pip.met)).join(""))
          .join();
        if (needsSig !== state.needsSig) state.set({ needsSig });
      },
      say(npcKey, words, secs, opts) {
        const epochMs = Date.now();
        const to = opts?.to;
        // those addressed have been answered, so their lines may go
        if (to !== undefined) w.bubble?.release(...to);
        const parties = [npcKey, ...(to ?? [])];
        const entry: SpeechEntry = { id: state.nextId++, npcKey, words, epochMs, parties, nodeId: opts?.nodeId };

        state.history.push(entry);
        if (state.history.length > maxHistory) state.history.shift();

        // unseen, with the history shut: the button says so
        if (state.panelOpen === false || state.panelTab !== "speech") state.unread = true;
        state.update();

        // over their head
        w.bubble?.say(npcKey, words, { secs, hold: opts?.hold });

        w.events.next({ key: "speech", npcKey, words, epochMs, to });
      },
      think(npcKey, words, tag) {
        const playerKey = w.player?.key;
        // in their thread with the player, who alone reads it: no event, so no client hears of it
        const parties = playerKey === undefined ? [npcKey] : [npcKey, playerKey];
        state.history.push({ id: state.nextId++, npcKey, words, epochMs: Date.now(), parties, thought: tag });
        if (state.history.length > maxHistory) state.history.shift();
        if (state.panelOpen === false || state.panelTab !== "speech") state.unread = true;
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
      },
    });
    return () => sub.unsubscribe();
  }, []);

  // seen, once the history is open on what was said
  const unread = state.unread && (state.panelOpen === false || state.panelTab !== "speech");
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
                  {state.panelTab === "speech" && (
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

              {state.panelTab === "speech" && (
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

              {/* drag its foot to set the height alone: clear of the corner, which sets both */}
              <div
                className="absolute bottom-0 left-5 right-0 h-1.5 touch-none cursor-ns-resize"
                onMouseDown={(e) => state.onResizeMouseDown(e, true)}
                onTouchStart={(e) => state.onResizeTouchStart(e, true)}
              />

              {/* drag to resize the panel — bottom-left corner, since the panel is right-anchored */}
              <div
                className="absolute bottom-0 left-0 size-5 touch-none cursor-nesw-resize"
                onMouseDown={(e) => state.onResizeMouseDown(e)}
                onTouchStart={(e) => state.onResizeTouchStart(e)}
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

/** One thread of the history, and should it be a talk with the player, their replies */
function SpeechThread({ thread }: { thread: Thread }) {
  const w = useContext(WorldContext);
  const talk = w.speech.talks[thread.key] as Talk | undefined;
  const playerKey = w.player?.key;
  const node = talk?.conv.nodes[talk.at];
  const lastId = thread.entries.at(-1)?.id;
  const gone = talk !== undefined && !(talk.npcKey in w.n);

  /** An ending keeps the topic it follows: "the end" below says the rest */
  let topic: string | undefined;
  const lines = thread.entries.map((entry): TalkLine => {
    const said = entry.nodeId === undefined ? undefined : talk?.conv.nodes[entry.nodeId];
    if (said !== undefined && (said.choices?.length ?? 0) > 0) topic = said.topic;
    return {
      id: entry.id,
      // the player's on the right; between npcs, the first of them on the left
      side:
        entry.npcKey === (playerKey !== undefined && thread.parties.includes(playerKey) ? playerKey : thread.parties[1])
          ? "right"
          : "left",
      text: entry.words,
      thought: entry.thought,
      topic: said === undefined ? undefined : topic,
      who: thread.parties.length > 2 ? entry.npcKey : undefined,
      ...(talk !== undefined &&
        entry.nodeId !== undefined &&
        entry.id !== lastId &&
        gone === false && {
          title: "answer this again",
          onClick: () => w.speech.revisitTalk(thread.key, entry.id),
        }),
    };
  });
  const replies =
    talk === undefined || gone || talk.answer !== null
      ? []
      : (node?.choices ?? []).map((choice, i) => ({
          text: choice.text,
          pips: w.speech.getPips(talk, choice),
          seen: talk.seen.has(choice.to),
          onChoose: () => w.speech.chooseTalk(thread.key, i),
        }));

  return (
    <div className="flex flex-col gap-1 border-t border-slate-700 pt-1 first:border-t-0">
      <div className="flex flex-wrap items-center text-slate-500">
        {thread.parties.map((npcKey, i) => (
          <span key={npcKey} className="flex items-center">
            {i > 0 && "·"}
            <NpcKeyMenu npcKey={npcKey} className="px-1 text-xs" />
          </span>
        ))}
        <XIcon
          className="ml-auto size-3.5 shrink-0 cursor-pointer text-slate-600 hover:text-red-300"
          onClick={() => w.speech.clearThread(thread.key)}
        >
          <title>clear this conversation</title>
        </XIcon>
      </div>
      <TalkThread
        lines={lines}
        replies={replies}
        repliesKey={`${talk?.at}:${lastId}`}
        typing={talk !== undefined && talk.answer !== null}
        onClear={(ids) => w.speech.clearEntries(ids.filter((id) => typeof id === "number"))}
        footer={
          talk !== undefined &&
          (gone ? (
            <div className="self-center text-slate-500 italic">{talk.npcKey} is gone</div>
          ) : (
            talk.answer === null &&
            replies.length === 0 && <div className="self-center text-slate-500 italic">the end</div>
          ))
        }
      />
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

  const npc = w.n[npcKey];
  // `setNpcLit` refuses the player, so the item would silently do nothing for them
  const canLightOrDelete = npc !== undefined && npc.key !== w.player?.key;

  return (
    <Menu.Root onOpenChange={() => setArmed(false)}>
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
                onClick={() => w.bubble.toggleDebug(npcKey)}
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
              <Menu.Item
                className={speechMenuItemClassName}
                closeOnClick={false}
                // `setNpcLit` writes a uniform, so nothing here re-renders on its own
                onClick={() => (w.e.setNpcLit(npc), w.speech.update())}
              >
                {npc.lit === true ? "unlight" : "light"}
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
                onClick={() => (item.action(npcKey), w.speech.update())} // its `text` may change, e.g. pick/unpick
              >
                {typeof item.text === "function" ? item.text(npcKey) : item.text}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
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
  /** The line of a talk it is */
  nodeId?: string;
  /** Thought, not said: read by psi */
  thought?: ThoughtTag;
};

/** A conversation tree the player is having with `npcKey`, in the thread of the two */
export type Talk = {
  conv: Conversation;
  npcKey: string;
  playerKey: string;
  /** The line now replied to */
  at: string;
  /** The player has spoken, and the npc will answer with `nodeId` in `secs` of world time */
  answer: null | { nodeId: string; secs: number };
  /** Lines reached, so a reply leading to one is ticked */
  seen: Set<string>;
};

type Thread = { key: string; parties: string[]; entries: SpeechEntry[] };

/** An item added to every `NpcKeyMenu` by e.g. a jsh command — see `addMenuItem` */
export type SpeechMenuItem = {
  key: string;
  text: string | ((npcKey: string) => string);
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
  /** By `threadKeyOf` the player and npc */
  talks: Record<string, Talk>;
  /** The pips last drawn, so a poll re-renders only on a change */
  needsSig: string;
  needsSecs: number;
  addMenuItem(item: SpeechMenuItem): void;
  removeMenuItem(key: string): void;
  clear(): void;
  /** Some lines of the history, e.g. a talk's run about one topic — the talk carries on */
  clearEntries(ids: number[]): void;
  /** One thread's history, and its talk — two parties, one, or a group's */
  clearThread(threadKey: string): void;
  getMaxY(): number;
  getClampedY(y: number): number;
  getMaxHistoryHeight(): number;
  getClampedHistoryHeight(height: number): number;
  getMaxHistoryWidth(): number;
  getClampedHistoryWidth(width: number): number;
  /** Answers fall due and pips are looked at again — called from `World`'s `onTick` while unpaused */
  onTick(delta: number): void;
  onResize(): void;
  /** From the corner, both ways; from the foot, `heightOnly` */
  onResizeMouseDown(e: React.MouseEvent, heightOnly?: boolean): void;
  onResizeTouchStart(e: React.TouchEvent, heightOnly?: boolean): void;
  persistY(): void;
  persistHistorySize(): void;
  /** Into the history, and over their head for `secs` — or, on `hold`, until someone it addresses answers */
  say(npcKey: string, words: string, secs?: number, opts?: { to?: string[]; nodeId?: string; hold?: boolean }): void;
  /** Into the history as a thought of theirs, and over their head — see `Psi.readThoughts` */
  think(npcKey: string, words: string, tag: ThoughtTag): void;
  /** The npc opens `conv` with the player, in the thread of the two. False without either */
  startTalk(conv: Conversation, npcKey: string): boolean;
  /** The player says a reply of the line replied to, once its tests pass, and the npc answers */
  chooseTalk(threadKey: string, index: number): void;
  /** The npc says the line the player's reply led to, unless gone */
  answerTalk(threadKey: string): void;
  /** The npc says an earlier line again, at the foot, and it is replied to there: nothing is removed */
  revisitTalk(threadKey: string, entryId: number): void;
  /** A reply's tests, as pips */
  getPips(talk: Talk, choice: ConversationChoice): TalkPip[];
};

const speechPanelTabs = ["worlds", "speech"] as const;

const minHistoryHeight = 120;
const minHistoryWidth = 200;
const maxHistory = 200;
/** Seconds between looks at the replies' tests */
const needsPollSecs = 0.2;
/** Seconds of world time an npc takes to answer: none pass whilst paused */
const answerSecs = 0.45;
