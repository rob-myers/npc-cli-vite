import { cn, useStateRef } from "@npc-cli/util";
import { useContext, useEffect } from "react";
import * as THREE from "three/webgpu";
import { OverlayBounds, toScreen } from "../service/overlay";
import { type ThoughtTag, thoughtConfig } from "../service/thoughts";
import { Glyphed } from "./TalkThread";
import { WorldContext } from "./world-context";

/** One bubble over an npc, following them: the line they last said, for a few seconds, and a thought read off them */
export default function NpcBubbles() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      boxes: new OverlayBounds(() => w.r3f?.invalidate()),
      el: null,
      els: new Map(),
      hidden: new Set(),
      lines: new Map(),
      observer: new ResizeObserver((items) => {
        for (const { target } of items) state.sizes.set(target, sizeOf(target as HTMLElement));
        w.r3f?.invalidate();
      }),
      sizes: new WeakMap(),
      thoughts: new Map(),

      delete(...npcKeys) {
        for (const npcKey of npcKeys) {
          state.lines.delete(npcKey);
          state.thoughts.delete(npcKey);
          state.hidden.delete(npcKey);
        }
        state.update();
      },
      onTick(delta) {
        for (const [npcKey, line] of state.lines) {
          const last = line.page === line.pages.length - 1;
          if (last && line.held) continue;
          if ((line.secs -= delta) > 0) {
            // written to the DOM, rendering nothing. A new line replaces it at full opacity
            if (last && line.secs < lineFadeSecs && line.el) line.el.style.opacity = `${line.secs / lineFadeSecs}`;
            continue;
          }
          if (last === false) {
            line.page++;
            line.secs = line.page === line.pages.length - 1 ? line.lastSecs : lineSecsOf(line.pages[line.page]);
            showPage(line);
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
      place() {
        const camera = w.r3f?.camera;
        if (camera === undefined || state.boxes.sync(state.el, w.view.canvas) === false) return;
        const { canvas, box } = state.boxes;
        camera.updateMatrixWorld(); // as it is this frame, not the last
        // nothing is read from the DOM here: sizes come from `observer`
        for (const [npcKey, el] of state.els) {
          const npc = w.n?.[npcKey];
          const size = state.sizes.get(el);
          if (npc === undefined || size === undefined) continue;
          tmpPoint.setFromMatrixPosition(npc.skinnedMesh.matrixWorld).add(npc.bubbleOffset);
          const { x, y } = toScreen(tmpPoint, camera, canvas, box);
          // kept inside the World's edges, as a menu is
          const half = size.width / 2;
          const clampedX = Math.max(half, Math.min(x, box.width - half));
          const clampedY = Math.max(size.height, y);
          el.style.transform = `translate(${clampedX}px,${clampedY}px) translate(-50%,-100%)`;
        }
      },
      release(...npcKeys) {
        for (const npcKey of npcKeys) {
          const line = state.lines.get(npcKey);
          if (line?.held !== true) continue;
          line.held = false;
          line.lastSecs = lineSecsOf(line.pages[line.pages.length - 1]);
          if (line.page === line.pages.length - 1) line.secs = line.lastSecs;
        }
      },
      say(npcKey, words, { secs, hold = false } = {}) {
        if (!(npcKey in w.n)) return;
        const pages = pagesOf(words);
        const lastSecs = secs ?? lineSecsOf(pages[pages.length - 1]);
        const first = pages.length === 1 ? lastSecs : lineSecsOf(pages[0]);
        state.lines.set(npcKey, { words, pages, page: 0, secs: first, lastSecs, held: hold });
        state.sync(npcKey);
      },
      setShown(npcKey, shown) {
        if (shown === !state.hidden.has(npcKey)) return;
        shown ? state.hidden.delete(npcKey) : state.hidden.add(npcKey);
        state.update();
      },
      sync(npcKey) {
        if (w.n?.[npcKey] === undefined) {
          state.lines.delete(npcKey);
          state.thoughts.delete(npcKey);
        }
        state.update();
        w.r3f?.invalidate(); // placed on the next frame
      },
      syncRoomFades() {
        for (const [npcKey, el] of state.els) {
          const npc = w.n[npcKey];
          if (npc === undefined) continue;
          const lit = npc.npcLit.value * w.view.litNpcsEnabled.value;
          el.style.opacity = `${Math.max(w.view.fadeRoomsFx.visibilityOf(npc.roomSlot.value), lit)}`;
        }
      },
      think(npcKey, words, tag) {
        if (!(npcKey in w.n)) return;
        state.thoughts.set(npcKey, { words, tag, secs: thoughtConfig.shownSecs });
        state.sync(npcKey);
      },
    }),
  );

  w.bubble = state;

  const npcKeys = [...new Set([...state.lines.keys(), ...state.thoughts.keys()])];
  const live = npcKeys.length > 0;

  useEffect(() => {
    if (live === false) return;
    // over their heads in the World's own frame, after the camera has moved
    return w.e.addFrameCallback(() => state.place());
  }, [live]);

  useEffect(
    () => () => {
      state.observer.disconnect();
      state.boxes.dispose();
    },
    [],
  );

  return (
    <div
      ref={(el) => void (state.el = el)}
      className="pointer-events-none absolute inset-0 z-10 select-none overflow-hidden"
    >
      {npcKeys.map((npcKey) => {
        const line = state.lines.get(npcKey);
        const thought = state.thoughts.get(npcKey);
        return (
          <div
            key={npcKey}
            ref={(el) => {
              const prev = state.els.get(npcKey);
              if (prev !== undefined && prev !== el) state.observer.unobserve(prev);
              if (el === null) return void state.els.delete(npcKey);
              if (prev !== el) {
                state.observer.observe(el);
                state.sizes.set(el, sizeOf(el)); // for its first place, before the observer reports
              }
              state.els.set(npcKey, el);
              state.syncRoomFades();
              state.place(); // else it shows at the corner until the next frame
            }}
            className={cn("absolute top-0 left-0 flex flex-col items-center", state.hidden.has(npcKey) && "invisible")}
          >
            {thought !== undefined && <ThoughtBubble words={thought.words} tag={thought.tag} />}
            {line !== undefined && (
              <SaidBubble
                pages={line.pages}
                elRef={(el) => {
                  line.el = el;
                  // the element is reused by the next line said, at its own fade, e.g. none whilst paused
                  if (el === null) return;
                  const last = line.page === line.pages.length - 1;
                  el.style.opacity = last ? `${Math.min(1, line.secs / lineFadeSecs)}` : "1";
                  showPage(line);
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The line said, click-through: one page shown at a time, see `showPage` */
function SaidBubble({ pages, elRef }: { pages: string[]; elRef: (el: HTMLDivElement | null) => void }) {
  return (
    <div
      ref={elRef}
      className="mb-1.5 w-max max-w-64 rounded-xl border border-white/30 bg-black/75 px-2.5 py-1 text-[13px] text-white/95"
    >
      {pages.map((page, i) => (
        <span key={i} data-page={i}>
          <Glyphed text={page} />
        </span>
      ))}
      {pages.length > 1 && <span data-page-count="" className="ml-1.5 text-[10px] text-white/50" />}
    </div>
  );
}

/** Shows its current page alone, and which it is: written to the DOM, so a page turns without a render */
function showPage(line: Line) {
  const el = line.el;
  if (el === null || el === undefined) return;
  for (const span of el.querySelectorAll<HTMLElement>(":scope > [data-page]")) {
    span.style.display = span.dataset.page === `${line.page}` ? "" : "none";
  }
  const count = el.querySelector<HTMLElement>(":scope > [data-page-count]");
  if (count !== null) count.textContent = `${line.page + 1}/${line.pages.length}`;
}

/** A line as pages: whole sentences, each page at most `pageChars` unless one word is longer */
function pagesOf(words: string) {
  const sentences = words.trim().match(/[^.!?…]+(?:[.!?…]+["')\]]*|$)\s*/g) ?? [words];
  const pages: string[] = [];
  for (const part of sentences.flatMap((sentence) =>
    sentence.length <= pageChars ? [sentence] : sentence.split(/(?<=\s)/),
  )) {
    const last = pages.at(-1);
    if (last !== undefined && last.length + part.length <= pageChars) pages[pages.length - 1] = last + part;
    else pages.push(part);
  }
  const trimmed = pages.map((page) => page.trim()).filter((page) => page !== "");
  return trimmed.length > 0 ? trimmed : [words];
}

/** A thought read off them, click-through: outlined in its khandha's colour, which it names */
function ThoughtBubble({ words, tag }: { words: string; tag: ThoughtTag }) {
  return (
    <div
      className="mb-1.5 w-max max-w-64 rounded-xl border border-dashed bg-black/60 px-2.5 py-1 text-[13px] italic"
      style={{ borderColor: tag.color, color: tag.color }}
    >
      <div className="text-[10px] uppercase not-italic opacity-70">{tag.khandha}</div>
      <Glyphed text={words} />
    </div>
  );
}

/** Seconds a line said stays over them, whilst unpaused: long enough to be found, then read, word by word */
const lineSecsOf = (words: string) =>
  Math.min(lineConfig.minSecs + lineConfig.wordSecs * words.trim().split(/\s+/).length, lineConfig.maxSecs);
const lineConfig = { minSecs: 2, wordSecs: 0.4, maxSecs: 10 };
/** Characters a bubble's page holds, at most */
const pageChars = 120;
/** Its last seconds, in which it fades out */
const lineFadeSecs = 1;

const tmpPoint = new THREE.Vector3();

const sizeOf = (el: HTMLElement) => ({ width: el.offsetWidth, height: el.offsetHeight });

export type State = {
  /** The canvas and this overlay, as last measured on a resize */
  boxes: OverlayBounds;
  el: null | HTMLDivElement;
  /** Each bubble, by npcKey, faded with their room */
  els: Map<string, HTMLDivElement>;
  /** Measures each bubble as it resizes, so `place` reads nothing */
  observer: ResizeObserver;
  /** Each bubble's size, as last measured */
  sizes: WeakMap<Element, { width: number; height: number }>;
  /** Whose bubble is hidden, e.g. whilst they fade out to be moved */
  hidden: Set<string>;
  /** The line each said last, and the seconds it has left — none whilst `held` */
  lines: Map<string, Line>;
  /** The thought last read off each, and the seconds it has left */
  thoughts: Map<string, { words: string; tag: ThoughtTag; secs: number }>;
  delete(...npcKeys: string[]): void;
  /** Lines run down whilst unpaused — see `World`'s `onTick` */
  onTick(delta: number): void;
  /** Each frame: pins each bubble over its npc's head */
  place(): void;
  /** A held line starts its `lineSecsOf`, e.g. once answered */
  release(...npcKeys: string[]): void;
  /** Over them, replacing what they said before, page by page. Its last page lasts `secs`, or until released when `hold` */
  say(npcKey: string, words: string, opts?: { secs?: number; hold?: boolean }): void;
  setShown(npcKey: string, shown: boolean): void;
  /** Their bubble as it should be: a line, a thought, both, or gone */
  sync(npcKey: string): void;
  /** Each bubble's opacity is their body's: their room's fade, unless they are lit. Written to the DOM */
  syncRoomFades(): void;
  /** Over them as a thought, above anything they are saying, for `thoughtConfig.shownSecs` */
  think(npcKey: string, words: string, tag: ThoughtTag): void;
};

/** A line said, shown a page at a time: `secs` are the current page's, `lastSecs` the last page's */
type Line = {
  words: string;
  pages: string[];
  page: number;
  secs: number;
  lastSecs: number;
  held: boolean;
  el?: HTMLDivElement | null;
};
