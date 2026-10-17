import { Task, useStateRef } from "@npc-cli/util";
import { deltaAngle } from "maath/misc";
import { AnimatePresence, motion } from "motion/react";
import { useContext, useEffect } from "react";
import * as THREE from "three/webgpu";
import { bodyPartPoint } from "../service/phaser-beam";
import type { Npc } from "./npc";
import { WorldContext } from "./world-context";

/**
 * Focus on an npc, as a called shot in Fallout: carrying a phaser, a press on someone raises it and turns to them, then pauses the
 * World and pins a choice over each part of them, the view held still. Chosen or not, the World resumes — see `docs/engagements.md`
 */
export default function NpcFocus() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      npcKey: null,
      placedKey: null,
      busy: false,
      offAim: false,
      resumed: false,
      before: null,
      el: null,
      markEls: {},
      dotEls: {},
      lineEls: {},
      clearEl: null,
      task: null,
      abandon() {
        Object.assign(state, { before: null, busy: false });
        w.view.pausedHidden = false;
        state.task?.cancel();
        state.task = null;
        // left raised, it no longer points at them
        if (w.phasers.isArmed(w.player.key) === true) w.phasers.arm(w.player.key);
        w.view.forceUpdate(); // the paused indicator, should the World still be paused
      },
      async aimAt(npcKey) {
        const player = w.player.get();
        const npc = w.n?.[npcKey];
        if (player === undefined || npc === undefined) return;
        // one still open once resumed gives way, and whether the phaser was up before it carries over
        const replaced = state.npcKey !== null && state.resumed === true ? state.before : null;
        if (replaced !== null) state.dismiss();
        const task = state.begin(npcKey, replaced?.raised);
        if (task === null) return;
        const { isClear, isDrawnIn } = w.phasers;
        const { key } = player;
        await task.run(async () => {
          await task.until(() => w.disabled === false); // e.g. begun by jsh whilst paused
          const { anim } = player;
          // raised as they turn to them, lain rolling to them if they can. Each is waited on for so long at most
          w.phasers.arm(key, { toward: npcKey });
          if (w.phasers.isArmed(key) === false) return state.abandon(); // e.g. in pain
          if (anim.posture === "sit") {
            // sat they turn their head, not round
            anim.turnTo(npc.point);
            await task.until(() => anim.turn.value === anim.turn.target, npcFocusConfig.turnMaxMs);
          } else if (anim.posture === "stand") {
            await task.wait(
              player.look({ at: npc.point }).catch(() => {}),
              npcFocusConfig.turnMaxMs,
            );
          }
          // too far round to face, sat or lain
          if (isOffAim(player, npc) === true) return state.abandon();
          // clear as they now stand: the turn may have swept past a wall, or ended facing one
          await task.until(() => isClear(key) === true, npcFocusConfig.raiseMaxMs);
          // still drawn in, or stowed lain, e.g. by a wall alongside, or out of sight: left raised, with nothing to choose
          if (isDrawnIn(key) === true) return state.abandon();
          // aimed before the pause, which would hold the arm, or a roll, partway
          await task.until(() => w.phasers.isAimed(key) === true, npcFocusConfig.raiseMaxMs);
          const seen = await task.wait(
            w.e.raycast(player.point, npc.point).then(
              ({ hit }) => hit === null,
              () => false,
            ),
          );
          if (seen === true && w.n?.[npcKey] !== undefined) state.open(npcKey);
          if (state.npcKey === null) return state.abandon();
          await task.wait(); // until it is over
        });
      },
      begin(npcKey, raised = w.phasers.isArmed(w.player.key)) {
        if (state.busy === true || w.n?.[npcKey] === undefined) return null;
        state.before = { paused: w.disabled, raised };
        state.busy = w.view.pausedHidden = true;
        state.task = new Task(() => w.disabled);
        return state.task;
      },
      cancel() {
        if (state.npcKey !== null) return state.close(null);
        if (state.before?.raised === false) w.phasers.disarm(w.player.key);
        state.abandon();
      },
      close(part) {
        const { npcKey, before } = state;
        if (npcKey === null || before === null) return;
        // the view stays where it came in to: a follow takes it on from there, once the World runs again
        if (before.paused === false) w.setDisabled(false);
        state.dismiss();
        // raised for the shot alone, else lowered: unless raised before, when it stays so
        const once = before.raised === false;
        if (part !== null && w.n?.[npcKey] !== undefined) {
          w.phasers.arm(w.player.key, { at: npcKey, part: npcFocusConfig.bones[part], once });
        } else if (once === true) w.phasers.disarm(w.player.key);
      },
      dismiss() {
        if (state.npcKey === null) return;
        Object.assign(state, { npcKey: null, offAim: false });
        state.abandon();
        state.update();
      },
      isFixated() {
        return state.busy === true && state.resumed === false;
      },
      isLost() {
        return (
          w.n?.[state.npcKey ?? ""] === undefined ||
          w.player.exists() === false ||
          w.phasers.isArmed(w.player.key) === false
        );
      },
      isOffAim() {
        const player = w.player.get();
        const npc = w.n?.[state.npcKey ?? ""];
        if (player === undefined || npc === undefined || isOffAim(player, npc) === true) return true;
        // sat or lain, by where their arm points: `r` may re-aim it once resumed
        return (w.phasers.aimOff(player.key, npc.point) ?? 0) > npcFocusConfig.maxOffAimRad;
      },
      open(npcKey) {
        const npc = w.n?.[npcKey];
        const { controls } = w.view;
        if (state.npcKey !== null || npc === undefined || controls == null) return;
        if (state.busy === false && state.begin(npcKey) === null) return;
        Object.assign(state, { npcKey, placedKey: npcKey, resumed: false });
        state.setOffAim(false); // a node kept from one still fading out has its last fade
        if (state.before !== null) state.before.paused = w.disabled; // as it was before this pause
        w.setDisabled(true);
        // the view stays as it is: `place` nudges it only if their overlay would go off screen
        w.view.forceUpdate(); // the paused indicator, hidden whilst open
        state.update();
      },
      keepOnScreen(bounds, canvas, box) {
        const { screenMargin: m, keepInRate } = npcFocusConfig;
        const [cx, cy] = [canvas.left - box.left, canvas.top - box.top];
        const ox = Math.min(0, bounds.minX - (cx + m)) + Math.max(0, bounds.maxX - (cx + canvas.width - m));
        const oy = Math.min(0, bounds.minY - (cy + m)) + Math.max(0, bounds.maxY - (cy + canvas.height - m));
        if (Math.abs(ox) + Math.abs(oy) <= 0.5) return;
        w.view.controls?.pan(-ox * keepInRate, -oy * keepInRate);
        w.r3f?.invalidate();
      },
      place() {
        const npc = w.n?.[state.placedKey ?? ""];
        const camera = w.r3f?.camera;
        if (npc === undefined || camera === undefined || state.el === null) return;
        camera.updateMatrixWorld(); // as it is this frame, not the last
        const canvas = w.view.canvas.getBoundingClientRect();
        const box = state.el.getBoundingClientRect();
        const onScreen = (bone: string) => toScreen(bodyPartPoint(npc, bone, tmpPoint), camera, canvas, box);
        const middle = onScreen("chest").x;
        const parts = npcFocusParts.map(({ part }) => ({ part, ...onScreen(npcFocusConfig.bones[part]) }));
        const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (const mark of layoutMarks(parts, middle)) writeMark(state, mark, bounds);
        if (state.clearEl !== null) {
          const at = `translate(${middle}px,${bounds.minY - npcFocusConfig.rowPx / 2}px)`;
          state.clearEl.style.transform = `${at} translate(-50%,-100%)`; // above the marks, centred on them
          state.clearEl.style.visibility = "visible";
        }
        if (w.disabled === true) state.keepOnScreen(bounds, canvas, box); // resumed, the view is follow's
      },
      setOffAim(offAim) {
        state.offAim = offAim;
        if (state.el === null) return;
        state.el.style.opacity = offAim ? "0" : "";
        state.el.inert = offAim;
      },
    }),
  );

  w.npcFocus = state;

  useEffect(() => {
    if (state.npcKey === null) return;
    /** Before the World's own keys: a digit there is a slot of the bar */
    const onKeyDown = (e: KeyboardEvent) => {
      if (state.offAim === true) return;
      if (e.key === "Escape" && state.resumed === true) return; // the World's pause key again, once resumed
      const part = npcFocusParts[Number(e.key) - 1]?.part;
      if (e.key !== "Escape" && part === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      state.close(e.key === "Escape" ? null : part);
    };
    window.addEventListener("keydown", onKeyDown, true);
    // pinned to their parts in the World's own frame, after the camera has moved, so they keep up with it
    const unsubscribe = w.e.addFrameCallback(() => {
      if (state.isLost() === true) return state.close(null); // e.g. lowered by `e`
      const offAim = state.isOffAim();
      if (offAim !== state.offAim) state.setOffAim(offAim);
      if (offAim === false) state.place();
    });
    w.r3f?.invalidate(); // a first frame to place them in
    const sub = w.events.subscribe({
      next(e) {
        if (e.key !== "enabled" || state.resumed === true) return;
        state.set({ resumed: true }); // its note goes: Escape no longer ends this
        w.view.pausedHidden = false; // a pause from here on is the player's own, so shows
      },
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribe();
      sub.unsubscribe();
    };
  }, [state.npcKey]);

  useEffect(() => {
    if (state.npcKey !== null || state.placedKey === null) return;
    // closed, its marks fade out on their parts as the World runs on
    return w.e.addFrameCallback(() => state.place());
  }, [state.npcKey, state.placedKey]);

  return (
    // faded out on closing. Only the marks take the pointer: the view is still the camera's to move
    <AnimatePresence onExitComplete={() => state.set({ placedKey: null })}>
      {state.npcKey !== null && (
        <motion.div
          key="npc-focus"
          className="pointer-events-none absolute inset-0 z-20 select-none overflow-hidden"
          animate={{ opacity: 1 }} // reopened mid fade out, it fades back in
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div ref={(el) => void (state.el = el)} className="absolute inset-0 transition-opacity duration-400">
            <svg className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
              {npcFocusParts.map(({ part }) => (
                <line
                  key={part}
                  ref={(el) => void (state.lineEls[part] = el)}
                  stroke="white"
                  strokeOpacity={0.45}
                  style={{ visibility: "hidden" }}
                />
              ))}
            </svg>
            {npcFocusParts.map(({ part, label }, i) => (
              // its dot on the part, its label in a column beside them
              <div key={part} className="group contents">
                <span
                  ref={(el) => void (state.dotEls[part] = el)}
                  className="pointer-events-auto absolute top-0 left-0 size-3 cursor-pointer rounded-full border border-white/80 bg-red-500/30 group-hover:bg-red-500"
                  style={{ visibility: "hidden" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    state.close(part);
                  }}
                />
                <button
                  ref={(el) => void (state.markEls[part] = el)}
                  type="button"
                  className="pointer-events-auto absolute top-0 left-0 cursor-pointer whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 font-mono text-[11px] text-white opacity-80 group-hover:opacity-100"
                  style={{ visibility: "hidden" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    state.close(part);
                  }}
                >
                  {i + 1} {label}
                </button>
              </div>
            ))}
            {state.resumed === true ? (
              // once resumed, a way to take the choice away without a shot
              <button
                ref={(el) => void (state.clearEl = el)}
                type="button"
                className="pointer-events-auto absolute top-0 left-0 cursor-pointer whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 font-mono text-[11px] text-white opacity-80 hover:opacity-100"
                style={{ visibility: "hidden" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  state.close(null);
                }}
              >
                clear
              </button>
            ) : (
              <div className="absolute inset-x-0 top-3 flex justify-center gap-1.5">
                <button
                  type="button"
                  className={noteClass}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    state.close(null);
                  }}
                >
                  Cancel (Esc)
                </button>
                <button
                  type="button"
                  className={noteClass}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    w.setDisabled(false);
                  }}
                >
                  Continue (Enter)
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const noteClass =
  "pointer-events-auto cursor-pointer rounded bg-black/60 px-2 py-0.5 font-mono text-[11px] text-white/80 hover:text-white";

/** Each part's dot, and its label in a column on its side of `middle`, stacked a row apart */
function layoutMarks(parts: { part: FocusPart; x: number; y: number }[], middle: number): Mark[] {
  const { labelGap, labelMinOff, rowPx } = npcFocusConfig;
  /** Pixels from their middle to each column: clear of every part, even seen from above where they bunch */
  const off = Math.max(labelMinOff, ...parts.map(({ x }) => Math.abs(x - middle))) + labelGap;
  return [true, false].flatMap((left) => {
    const side = parts.filter(({ x }) => x < middle - 1 === left).sort((a, b) => a.y - b.y);
    const rows = side.map(({ y }) => y);
    for (let i = 1; i < rows.length; i++) rows[i] = Math.max(rows[i], rows[i - 1] + rowPx);
    const shift = side.reduce((sum, { y }, i) => sum + y - rows[i], 0) / (side.length || 1);
    return side.map(({ part, x, y }, i) => ({
      part,
      x,
      y,
      left,
      lx: middle + (left ? -off : off),
      ly: rows[i] + shift,
    }));
  });
}

/** Writes `mark` to the DOM, not rendered, and grows `bounds` round it */
function writeMark(state: State, { part, x, y, left, lx, ly }: Mark, bounds: Bounds) {
  const [dot, label, line] = [state.dotEls[part], state.markEls[part], state.lineEls[part]];
  if (dot == null || label == null || line == null) return;
  dot.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
  label.style.transform = `translate(${lx}px,${ly}px) translate(${left ? -100 : 0}%,-50%)`;
  line.setAttribute("x1", `${x}`);
  line.setAttribute("y1", `${y}`);
  line.setAttribute("x2", `${lx}`);
  line.setAttribute("y2", `${ly}`);
  for (const el of [dot, label, line]) el.style.visibility = "visible";
  const [width, half] = [label.offsetWidth, label.offsetHeight / 2];
  bounds.minX = Math.min(bounds.minX, x, left ? lx - width : lx);
  bounds.maxX = Math.max(bounds.maxX, x, left ? lx : lx + width);
  bounds.minY = Math.min(bounds.minY, y, ly - half);
  bounds.maxY = Math.max(bounds.maxY, y, ly + half);
}

/** A part's dot on screen, and its label's place: in a column to the `left` or right */
type Mark = { part: FocusPart; x: number; y: number; left: boolean; lx: number; ly: number };

/** Round the overlay's marks, in its pixels */
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** A world point's place in the overlay, in pixels */
function toScreen(point: THREE.Vector3, camera: THREE.Camera, canvas: DOMRect, box: DOMRect) {
  point.project(camera);
  return {
    x: canvas.left - box.left + ((point.x + 1) / 2) * canvas.width,
    y: canvas.top - box.top + ((1 - point.y) / 2) * canvas.height,
  };
}

/** `player` faces more than `maxOffAimRad` away from `npc`. Sat or lain, `npc` is out of their reach */
function isOffAim(player: Npc, npc: Npc) {
  const { anim } = player;
  if (anim.posture !== "stand") return anim.canAimAt(npc.point) === false;
  return Math.abs(deltaAngle(player.rotation.y, anim.bearingOf(npc.point))) > npcFocusConfig.maxOffAimRad;
}

const tmpPoint = new THREE.Vector3();

const npcFocusConfig = {
  /** Radians they may face away from whom it is open on, e.g. turned once the World runs on, before it is dismissed */
  maxOffAimRad: (15 * Math.PI) / 180,
  /** The most milliseconds the turn to them is waited on */
  turnMaxMs: 3000,
  /** The most milliseconds the phaser is then waited on to come up clear, before the choice is offered anyway */
  raiseMaxMs: 1500,
  /** Pixels: a label column's least offset from their middle, its gap past their furthest part, and the rows' spacing */
  labelMinOff: 32,
  labelGap: 28,
  rowPx: 21,
  /** Pixels the overlay keeps inside the canvas edge, and how much of what pokes past the view moves by each frame */
  screenMargin: 16,
  keepInRate: 0.3,
  /** The bone each part is shot at: each in the hit region of its name — see `hitConfig.region` */
  bones: {
    head: "head",
    body: "chest",
    leftArm: "leftforearm",
    rightArm: "rightforearm",
    leftLeg: "leftshin",
    rightLeg: "rightshin",
  },
} as const;

export type FocusPart = keyof typeof npcFocusConfig.bones;

/** In digit order */
const npcFocusParts: { part: FocusPart; label: string }[] = [
  { part: "head", label: "Head" },
  { part: "body", label: "Body" },
  { part: "rightArm", label: "Right arm" },
  { part: "leftArm", label: "Left arm" },
  { part: "rightLeg", label: "Right leg" },
  { part: "leftLeg", label: "Left leg" },
];

export type State = {
  /** Whom it is open on, else `null` */
  npcKey: null | string;
  /** Whom the marks are placed on: kept as they fade out after it closes */
  placedKey: null | string;
  /** From the press until it is over. `w.view.pausedHidden` too, until resumed */
  busy: boolean;
  /** They face more than `maxOffAimRad` away from them: the marks are hidden until they face back */
  offAim: boolean;
  /** The World has been resumed since it opened: then Escape only pauses it, and no longer ends this */
  resumed: boolean;
  /** The pause and phaser to go back to */
  before: null | {
    paused: boolean;
    /** Their phaser was up already, e.g. by `e`: it is left up after */
    raised: boolean;
  };
  el: null | HTMLDivElement;
  /** Each part's label, in a column beside them, placed by `place` */
  markEls: Partial<Record<FocusPart, null | HTMLButtonElement>>;
  /** Each part's dot, on it */
  dotEls: Partial<Record<FocusPart, null | HTMLSpanElement>>;
  /** Each part's line, from its dot to its label */
  lineEls: Partial<Record<FocusPart, null | SVGLineElement>>;
  /** Once resumed, the button above the marks that takes the choice away */
  clearEl: null | HTMLButtonElement;
  /** Cancelled once it is over, which ends `aimAt` */
  task: null | Task;
  /** Gives up before it opens, the phaser left raised */
  abandon(): void;
  /** Raises the phaser and turns them to `npcKey`, then `open`s: resolved once it is over */
  aimAt(npcKey: string): Promise<void>;
  /** Notes the pause and phaser to go back to: `null` if under way already, else its `task` */
  /** `raised` is whether the phaser was up before, unless carried over from a focus it replaces */
  begin(npcKey: string, raised?: boolean): null | Task;
  /** As Escape, at any stage: from the press, until a part is chosen */
  cancel(): void;
  /** The World resumed, the view left where it is, then a shot at `part`, or none for `null` */
  close(part: null | FocusPart): void;
  /** Takes the choice away and nothing else: no shot, the pause and phaser as they are */
  dismiss(): void;
  /** Whilst it aims, and in the pause it opens in: the player is held to it, as a move would undo its turn */
  isFixated(): boolean;
  /** Either of them gone, or the phaser lowered */
  isLost(): boolean;
  /** They face, or sat or lain their arm points, more than `maxOffAimRad` away from whom it is open on */
  isOffAim(): boolean;
  /** Pauses, zooms in on them, and pins a choice over each part */
  open(npcKey: string): void;
  /** Paused, pans the view by part of how far `bounds` pokes past the canvas edge, so it stays in sight */
  keepOnScreen(bounds: Bounds, canvas: DOMRect, box: DOMRect): void;
  /** Each part's choice, pinned to where it is on screen now */
  place(): void;
  /** Fades the marks out through the DOM, not rendered, as the frame loop finds them off aim, or back in */
  setOffAim(offAim: boolean): void;
};
