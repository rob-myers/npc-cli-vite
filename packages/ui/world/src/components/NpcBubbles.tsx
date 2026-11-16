import { cn, useStateRef } from "@npc-cli/util";
import { MicrophoneIcon } from "@phosphor-icons/react";
import { memo, useCallback, useContext, useEffect } from "react";
import * as THREE from "three/webgpu";
import { OverlayBounds, toScreen } from "../service/overlay";
import { pageSecs, type Utterance } from "../service/speech";
import { type ThoughtTag, thoughtConfig } from "../service/thoughts";
import { Glyphed } from "./TalkThread";
import { WorldContext } from "./world-context";

import "./npc-bubbles.css";

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
      nextId: 0,
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
      dropLine(npcKey) {
        if (state.lines.delete(npcKey)) state.sync(npcKey);
      },
      missChunk(npcKey, chunk) {
        const line = state.lines.get(npcKey);
        if (line === undefined) return;
        line.unheard.add(chunk);
        showUnheard(line, [chunk]);
      },
      onTick(delta) {
        for (const [npcKey, line] of state.lines) {
          if (line.paused) continue;
          line.t += delta;
          if (line.t >= line.end) {
            state.lines.delete(npcKey);
            state.sync(npcKey);
            continue;
          }
          const { pageAt, words } = line.utt;
          const page = pageAt.findLastIndex((at) => at <= line.t);
          if (page !== line.page) {
            line.page = page;
            showPage(line);
          }
          // written to the DOM, rendering nothing
          for (; line.said < words.length && words[line.said].at <= line.t; line.said++) {
            state.sayWord(line, line.said);
          }
          const left = line.end - line.t;
          if (left < lineFadeSecs && line.el) line.el.style.opacity = `${left / lineFadeSecs}`;
        }
        for (const [npcKey, thought] of state.thoughts) {
          if ((thought.secs -= delta) > 0) continue;
          state.thoughts.delete(npcKey);
          state.sync(npcKey);
        }
        state.syncRoomFades(); // e.g. walked into a room out of view
      },
      place(only) {
        const camera = w.r3f?.camera;
        if (camera === undefined || state.boxes.sync(state.el, w.view.canvas) === false) return;
        const { canvas, box } = state.boxes;
        camera.updateMatrixWorld(); // as it is this frame, not the last
        // nothing is read from the DOM here: sizes come from `observer`
        for (const [npcKey, el] of state.els) {
          if (only !== undefined && npcKey !== only) continue;
          const npc = w.n?.[npcKey];
          const size = state.sizes.get(el);
          if (npc === undefined || size === undefined) continue;
          tmpPoint.setFromMatrixPosition(npc.skinnedMesh.matrixWorld).add(npc.bubbleOffset);
          const { x, y } = toScreen(tmpPoint, camera, canvas, box);
          // what is for the player is kept inside the World's edges, as a menu is
          if (state.thoughts.has(npcKey) === false && state.lines.get(npcKey)?.forPlayer !== true) {
            el.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
            continue;
          }
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
          const { pages, spokenSecs } = line.utt;
          line.end = Math.max(line.t, spokenSecs) + pageSecs(pages[pages.length - 1]);
        }
      },
      say(npcKey, utt, { secs, hold = false, forPlayer = false, comms = false } = {}) {
        if (!(npcKey in w.n)) return;
        const { pages, pageAt, spokenSecs } = utt;
        const end = hold
          ? Infinity
          : Math.max(pageAt[pageAt.length - 1] + (secs ?? pageSecs(pages[pages.length - 1])), spokenSecs);
        state.lines.set(npcKey, {
          id: state.nextId++,
          utt,
          t: 0,
          end,
          held: hold,
          paused: false,
          page: 0,
          said: 0,
          unheard: new Set(),
          forPlayer,
          comms,
          wordEls: [],
        });
        state.sync(npcKey);
      },
      sayWord(line, i) {
        line.wordEls[i]?.classList.add("said");
        line.el?.animate([{ transform: "scale(1)" }, { transform: "scale(1.03)" }, { transform: "scale(1)" }], {
          duration: wordPulseMs,
        });
      },
      setPaused(npcKey, paused) {
        const line = state.lines.get(npcKey);
        if (line !== undefined) line.paused = paused;
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
      syncRoomFades(only) {
        for (const [npcKey, el] of state.els) {
          if (only !== undefined && npcKey !== only) continue;
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
      {npcKeys.map((npcKey) => (
        <NpcBubble
          key={npcKey}
          npcKey={npcKey}
          line={state.lines.get(npcKey)}
          thought={state.thoughts.get(npcKey)}
          hidden={state.hidden.has(npcKey)}
          state={state}
        />
      ))}
    </div>
  );
}

/** One npc's bubble. Memoised with stable refs, so a line said elsewhere renders nothing here */
const NpcBubble = memo(function NpcBubble({
  npcKey,
  line,
  thought,
  hidden,
  state,
}: {
  npcKey: string;
  line?: Line;
  thought?: Thought;
  hidden: boolean;
  state: State;
}) {
  const ref = useCallback((el: HTMLDivElement | null) => {
    const prev = state.els.get(npcKey);
    if (prev !== undefined && prev !== el) state.observer.unobserve(prev);
    if (el === null) return void state.els.delete(npcKey);
    if (prev !== el) {
      state.observer.observe(el);
      state.sizes.set(el, sizeOf(el)); // for its first place, before the observer reports
    }
    state.els.set(npcKey, el);
    state.syncRoomFades(npcKey);
    state.place(npcKey); // else it shows at the corner until the next frame
  }, []);
  const lineRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (line === undefined) return;
      line.el = el;
      if (el === null) return;
      line.wordEls = [...el.querySelectorAll<HTMLElement>("[data-word]")];
      line.wordEls.forEach((wordEl, i) => wordEl.classList.toggle("said", i < line.said));
      el.style.opacity = `${Math.min(1, (line.end - line.t) / lineFadeSecs)}`;
      showPage(line);
      showUnheard(line, line.unheard);
    },
    [line],
  );
  return (
    <div ref={ref} className={cn("absolute top-0 left-0 flex flex-col items-center", hidden && "invisible")}>
      {thought !== undefined && <ThoughtBubble words={thought.words} tag={thought.tag} />}
      {/* a line of its own, so no word is shown as said by the last */}
      {line !== undefined && <SaidBubble key={line.id} line={line} elRef={lineRef} />}
    </div>
  );
});

/** The line said, click-through: one page shown at a time, its words lit as said — see `showPage`, `sayWord` */
function SaidBubble({ line, elRef }: { line: Line; elRef: (el: HTMLDivElement | null) => void }) {
  const { pageChunks, chunks, words } = line.utt;
  return (
    <div
      ref={elRef}
      className="said-bubble mb-1.5 w-max max-w-64 rounded-xl border border-white/30 bg-black/75 px-2.5 py-1 text-[13px] text-white/95"
    >
      {line.comms && <MicrophoneIcon weight="bold" className="mr-1 inline size-3 align-[-1px] text-white/60" />}
      {pageChunks.map((cs, p) => (
        <span key={p} data-page={p}>
          {cs.map((c, j) => (
            <span key={c} data-chunk={c}>
              {j > 0 && " "}
              {chunks[c].words.map((i, k) => (
                <span key={i} data-word={i}>
                  {k > 0 && " "}
                  <Glyphed text={words[i].text} />
                </span>
              ))}
            </span>
          ))}
        </span>
      ))}
      {pageChunks.length > 1 && <span data-page-count="" className="ml-1.5 text-[10px] text-white/50" />}
    </div>
  );
}

/** Chunks the player missed show as "…", by attribute so React's own nodes are left be */
function showUnheard(line: Line, chunks: Iterable<number>) {
  for (const chunk of chunks)
    line.el?.querySelector<HTMLElement>(`[data-chunk="${chunk}"]`)?.setAttribute("data-unheard", "");
}

/** Shows its current page alone, and which it is: written to the DOM, so a page turns without a render */
function showPage(line: Line) {
  const el = line.el;
  if (el === null || el === undefined) return;
  for (const span of el.querySelectorAll<HTMLElement>(":scope > [data-page]")) {
    span.style.display = span.dataset.page === `${line.page}` ? "" : "none";
  }
  const count = el.querySelector<HTMLElement>(":scope > [data-page-count]");
  if (count !== null) count.textContent = `${line.page + 1}/${line.utt.pages.length}`;
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

/** Its last seconds, in which it fades out */
const lineFadeSecs = 1;
/** A bubble's swell as each word is said */
const wordPulseMs = 150;

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
  /** The line each said last, by npcKey */
  lines: Map<string, Line>;
  nextId: number;
  /** The thought last read off each, and the seconds it has left */
  thoughts: Map<string, Thought>;
  delete(...npcKeys: string[]): void;
  /** Their line goes at once, any thought kept */
  dropLine(npcKey: string): void;
  /** The player missed `chunk` of the line `npcKey` is saying: it shows as "…" */
  missChunk(npcKey: string, chunk: number): void;
  /** Lines run down whilst unpaused — see `World`'s `onTick` */
  onTick(delta: number): void;
  /** Each frame: pins each bubble over its npc's head, or `only` theirs */
  place(only?: string): void;
  /** A held line's last page starts its `pageSecs`, e.g. once answered */
  release(...npcKeys: string[]): void;
  /**
   * Over them, replacing what they said before, page by page. Its last page lasts `secs`, or until released when `hold`.
   * Only one `forPlayer` is kept in view. `comms` shows a mic
   */
  say(
    npcKey: string,
    utt: Utterance,
    opts?: { secs?: number; hold?: boolean; forPlayer?: boolean; comms?: boolean },
  ): void;
  /** Word `i` is said: it lights, and the bubble swells */
  sayWord(line: Line, i: number): void;
  /** Holds their line mid-way, e.g. whilst `say` is suspended */
  setPaused(npcKey: string, paused: boolean): void;
  setShown(npcKey: string, shown: boolean): void;
  /** Their bubble as it should be: a line, a thought, both, or gone */
  sync(npcKey: string): void;
  /** Each bubble's opacity is their body's, or `only` theirs: their room's fade, unless they are lit. Written to the DOM */
  syncRoomFades(only?: string): void;
  /** Over them as a thought, above anything they are saying, for `thoughtConfig.shownSecs` */
  think(npcKey: string, words: string, tag: ThoughtTag): void;
};

/** A thought read off them, and the seconds it has left */
type Thought = { words: string; tag: ThoughtTag; secs: number };

/** A line said, shown a page at a time: `t` is seconds into it, and it goes at `end` */
type Line = {
  id: number;
  utt: Utterance;
  t: number;
  /** `Infinity` whilst `held` */
  end: number;
  held: boolean;
  /** Held mid-way: `t` stands still */
  paused: boolean;
  page: number;
  /** How many of its words are said */
  said: number;
  /** Chunks the player missed */
  unheard: Set<number>;
  forPlayer: boolean;
  comms: boolean;
  el?: HTMLDivElement | null;
  wordEls: HTMLElement[];
};
