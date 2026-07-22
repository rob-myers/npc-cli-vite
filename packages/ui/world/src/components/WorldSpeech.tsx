import { Menu } from "@base-ui/react/menu";
import { cn, useStateRef } from "@npc-cli/util";
import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import { ChatCircleTextIcon, TrashIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useMotionValue } from "motion/react";
import { useContext } from "react";
import { WorldContext } from "./world-context";

export function WorldSpeech() {
  const w = useContext(WorldContext);
  /** Bigger touch targets on mobile */
  const big = w.touchDevice;

  const state = useStateRef(
    (): State => ({
      dragged: false,
      panelOpen: false,
      history: [],
      minY: 40,
      nextId: 0,
      toasts: [],
      y: tryLocalStorageGetParsed<number>(storageKey(w.id)) ?? 40,

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
      onResize() {
        y.set(state.getClampedY(y.get()));
        state.update();
      },
      persistY() {
        tryLocalStorageSet(storageKey(w.id), `${state.getClampedY(y.get())}`);
      },
      say(npcKey, words, secs) {
        const epochMs = Date.now();
        const entry: SpeechEntry = { id: state.nextId++, npcKey, words, epochMs };

        state.history.push(entry);
        if (state.history.length > maxHistory) state.history.shift();

        state.toasts.push(entry);
        state.update();

        const delayMs = typeof secs === "number" ? secs * 1000 : defaultToastMs;
        setTimeout(() => {
          state.toasts = state.toasts.filter(({ id }) => id !== entry.id);
          state.update();
        }, delayMs);

        w.events.next({ key: "speech", npcKey, words, epochMs });
      },
    }),
  );

  w.speech = state;

  const y = useMotionValue(state.getClampedY(state.y));

  return (
    <motion.div
      className="absolute top-0 right-px z-10 touch-none select-none flex flex-col items-end"
      style={{ y }}
      drag="y"
      dragConstraints={{ top: state.minY, bottom: state.getMaxY() }}
      dragMomentum={false}
      onDragStart={() => (state.dragged = true)}
      onDragEnd={() => {
        state.persistY();
        requestAnimationFrame(() => (state.dragged = false));
      }}
    >
      <Menu.Root
        open={state.panelOpen}
        onOpenChange={(open, { reason }) => {
          if (open) {
            state.set({ panelOpen: true });
          } else if (reason === "outside-press" || reason === "escape-key" || reason === "item-press") {
            state.set({ panelOpen: false });
          }
        }}
      >
        <Menu.Trigger
          className="cursor-pointer outline-none"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            if (state.dragged) return;
            state.set({ panelOpen: !state.panelOpen });
          }}
        >
          <div
            className={cn(
              "grid place-items-center bg-gray-800 text-white",
              big ? "size-12" : "size-9",
            )}
          >
            <ChatCircleTextIcon className={big ? "size-6" : "size-5"} weight="bold" />
          </div>
        </Menu.Trigger>

        <Menu.Portal>
          <Menu.Positioner className="z-50" side="left" sideOffset={4} align="start">
            <Menu.Popup
              className={cn(
                "flex flex-col bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 w-72",
                big && "w-80 py-2",
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-between gap-2 px-2 py-1 text-xs text-slate-300",
                  big && "px-3 py-2 text-sm",
                )}
              >
                <span>speech history</span>
                <TrashIcon
                  className={cn(
                    "size-4 cursor-pointer text-slate-500 hover:text-red-300",
                    big && "size-5",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    state.clear();
                  }}
                />
              </div>

              <div className={cn("flex flex-col gap-1 px-2 pb-2 max-h-72 overflow-y-auto", big && "max-h-96")}>
                {state.history.length === 0 && (
                  <div className={cn("px-1 py-2 text-xs text-slate-500 italic", big && "text-sm")}>nothing said yet</div>
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
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <AnimatePresence>
        {state.toasts.map(({ id, npcKey, words }) => (
          <motion.div
            key={id}
            className={cn(
              "flex gap-2 bg-zinc-800/90 text-slate-300 text-xs p-3 py-1.5 max-w-72",
              big && "text-sm px-3 py-1.5 max-w-80",
            )}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <span className="shrink-0 font-medium text-sky-300">{npcKey}:</span>
            <span className="break-words">{words}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </motion.div>
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
  toasts: SpeechEntry[];
  y: number;
  clear(): void;
  getMaxY(): number;
  getClampedY(y: number): number;
  onResize(): void;
  persistY(): void;
  say(npcKey: string, words: string, secs?: number): void;
};

const storageKey = (id: string) => `world-speech-y-${id}`;
const maxHistory = 200;
const defaultToastMs = 4000;
