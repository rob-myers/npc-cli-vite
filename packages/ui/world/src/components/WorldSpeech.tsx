import { cn, useStateRef } from "@npc-cli/util";
import { ChatCircleTextIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useDragControls, useMotionValue } from "motion/react";
import { useContext } from "react";
import { getWorldStore } from "../service/storage";
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
      history: [],
      minY: 40,
      nextId: 0,
      toasts: [],
      y: saved.speechY,
      historyHeight: saved.speechHeight ?? (big ? 384 : 288),
      historyWidth: saved.speechWidth ?? (big ? 320 : 288),
      resizing: false,

      clear() {
        state.history = [];
        state.update();
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
      onResizeMouseDown(e) {
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = state.historyWidth;
        const startHeight = state.historyHeight;
        state.resizing = true;
        const onMove = (ev: MouseEvent) => {
          // panel is right-anchored, so dragging the corner left (negative dx) widens it
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
      onResizeTouchStart(e) {
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
        // ticks only advance while the world is unpaused (see World.tsx), so this doesn't drain
        // away in real-time while paused
        const n = state.toasts.length;
        state.toasts = state.toasts.filter((t) => (t.secs -= delta) > 0);
        if (state.toasts.length !== n) state.update();
      },
      say(npcKey, words, secs) {
        const epochMs = Date.now();
        const entry: SpeechEntry = { id: state.nextId++, npcKey, words, epochMs };

        state.history.push(entry);
        if (state.history.length > maxHistory) state.history.shift();

        state.toasts.push({ ...entry, secs: secs ?? defaultToastSecs });
        state.update();

        w.events.next({ key: "speech", npcKey, words, epochMs });
      },
    }),
  );

  w.speech = state;

  const y = useMotionValue(state.getClampedY(state.y));
  const dragControls = useDragControls();

  return (
    <>
      {/* history toggle — only the icon starts a drag, so scrolling the panel below never fights it */}
      <motion.div
        className="absolute top-0 right-px z-10 select-none flex flex-col items-end"
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
            "grid touch-none place-items-center cursor-pointer bg-gray-800 text-white",
            big ? "size-12" : "size-9",
          )}
          onPointerDown={(e) => dragControls.start(e)}
          onClick={() => {
            if (state.dragged) return;
            state.set({ panelOpen: !state.panelOpen });
          }}
        >
          <ChatCircleTextIcon className={big ? "size-6" : "size-5"} weight="bold" />
        </div>

        <AnimatePresence>
          {state.panelOpen && (
            <motion.div
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.15 }}
              className={cn(
                "relative mt-1 flex flex-col bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1",
                big && "py-2",
              )}
              style={{ width: state.historyWidth }}
            >
              <div
                className={cn(
                  "flex items-center justify-between gap-2 px-2 py-1 text-xs text-slate-300",
                  big && "px-3 py-2 text-sm",
                )}
              >
                <span>speech history</span>
                <div className="flex items-center gap-2">
                  <TrashIcon
                    className={cn("size-4 cursor-pointer text-slate-500 hover:text-red-300", big && "size-5")}
                    onClick={() => state.clear()}
                  />
                  <XIcon
                    className={cn("size-4 cursor-pointer text-slate-500 hover:text-slate-300", big && "size-5")}
                    onClick={() => state.set({ panelOpen: false })}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1 px-2 pb-2 overflow-y-auto" style={{ height: state.historyHeight }}>
                {state.history.length === 0 && (
                  <div className={cn("px-1 py-2 text-xs text-slate-500 italic", big && "text-sm")}>
                    nothing said yet
                  </div>
                )}
                {state.history
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <div
                      key={entry.id}
                      className={cn(
                        "flex gap-2 px-2 py-1 text-xs rounded bg-slate-900/60 text-slate-300",
                        big && "px-3 py-1.5 text-sm",
                      )}
                    >
                      <span className="shrink-0 font-medium text-sky-300">{entry.npcKey}:</span>
                      <span className="break-words">{entry.words}</span>
                    </div>
                  ))}
              </div>

              {/* drag to resize the panel — bottom-left corner, since the panel is right-anchored */}
              <div
                className="absolute bottom-0 left-0 size-5 touch-none cursor-nesw-resize"
                onMouseDown={state.onResizeMouseDown}
                onTouchStart={state.onResizeTouchStart}
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

      {/* toasts — bottom-center, where subtitles usually go; non-interactive so they don't block World */}
      <div className="absolute top-10 left-1/2 z-10 flex max-w-[90%] -translate-x-1/2 flex-col items-center gap-1 pointer-events-none">
        <AnimatePresence>
          {state.toasts.map(({ id, npcKey, words }) => (
            <motion.div
              key={id}
              className={cn(
                "flex gap-2 rounded bg-zinc-800/90 text-slate-300 text-[1rem] p-3 py-1.5 max-w-md text-center",
                big && "text-sm px-3 py-1.5 max-w-lg",
              )}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <span className="shrink-0 font-medium text-sky-300">{npcKey}:</span>
              <span className="wrap-break-word">{words}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}

export type SpeechEntry = {
  id: number;
  npcKey: string;
  words: string;
  epochMs: number;
};

export type State = {
  dragged: boolean;
  panelOpen: boolean;
  history: SpeechEntry[];
  minY: number;
  nextId: number;
  /** `secs` ticks down in `onTick` (see `World`'s `onTick`) — only while the world is unpaused */
  toasts: (SpeechEntry & { secs: number })[];
  y: number;
  /** Height (px) of the scrollable history list — resizable, persisted */
  historyHeight: number;
  /** Width (px) of the whole history panel — resizable, persisted */
  historyWidth: number;
  resizing: boolean;
  clear(): void;
  getMaxY(): number;
  getClampedY(y: number): number;
  getMaxHistoryHeight(): number;
  getClampedHistoryHeight(height: number): number;
  getMaxHistoryWidth(): number;
  getClampedHistoryWidth(width: number): number;
  /** Ticks down each toast's `secs`, removing expired ones — called from `World`'s `onTick` while unpaused */
  onTick(delta: number): void;
  onResize(): void;
  onResizeMouseDown(e: React.MouseEvent): void;
  onResizeTouchStart(e: React.TouchEvent): void;
  persistY(): void;
  persistHistorySize(): void;
  say(npcKey: string, words: string, secs?: number): void;
};

const minHistoryHeight = 120;
const minHistoryWidth = 200;
const maxHistory = 200;
const defaultToastSecs = 4;
