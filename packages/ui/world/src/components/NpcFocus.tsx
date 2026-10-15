import { Task, useStateRef } from "@npc-cli/util";
import { AnimatePresence, motion } from "motion/react";
import { useContext, useEffect } from "react";
import * as THREE from "three/webgpu";
import { bodyPartPoint } from "../service/phaser-beam";
import { WorldContext } from "./world-context";

/**
 * Focus on an npc, as a called shot in Fallout: carrying a phaser, a press on someone raises it and turns to them, then pauses the World,
 * zooms in on them, and pins a choice over each part of them. Chosen or not, the World resumes with the view left where it is
 */
export default function NpcFocus() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      npcKey: null,
      busy: false,
      offAim: false,
      resumed: false,
      before: null,
      el: null,
      markEls: {},
      task: null,
      abandon() {
        const { before } = state;
        Object.assign(state, { before: null, busy: false });
        w.view.pausedHidden = false;
        state.task?.cancel();
        state.task = null;
        // set aside only once it opens: given up on before, it was never turned off
        if (before?.follow === true && w.view.follow === false) w.view.setFollow(true);
        w.view.forceUpdate(); // the paused indicator, should the World still be paused
      },
      async aimAt(npcKey) {
        const player = w.player.get();
        const npc = w.n?.[npcKey];
        if (player === undefined || npc === undefined) return;
        const task = state.begin(npcKey);
        if (task === null) return;
        const { isClear, isDrawnIn } = w.phasers;
        const { key } = player;
        await task.run(async () => {
          await task.until(() => w.disabled === false); // e.g. begun by jsh whilst paused
          // raised as they turn to them. Each is waited on for so long at most
          w.phasers.arm(key);
          const looked = player.look({ at: npc.point }).catch(() => {}); // sat or lain they cannot turn
          await task.wait(looked, npcFocusConfig.turnMaxMs);
          // clear as they now stand: the turn may have swept past a wall, or ended facing one
          await task.until(() => isClear(key) === true, npcFocusConfig.raiseMaxMs);
          // still drawn in, e.g. by a wall alongside, or out of sight: left raised, with nothing to choose
          if (isDrawnIn(key) === true) return state.abandon();
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
      begin(npcKey) {
        if (state.busy === true || w.n?.[npcKey] === undefined) return null;
        state.before = {
          paused: w.disabled,
          follow: w.view.follow,
          raised: w.phasers.isArmed(w.player.key),
        };
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
        if (player === undefined || npc === undefined) return true;
        // their facing against the bearing to them: three's rotation-Y, as `bearingOf`
        const bearing = Math.atan2(player.position.x - npc.position.x, player.position.z - npc.position.z);
        const off = bearing - player.rotation.y;
        return Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) > npcFocusConfig.maxOffAimRad;
      },
      open(npcKey) {
        const npc = w.n?.[npcKey];
        const { controls } = w.view;
        if (state.npcKey !== null || npc === undefined || controls == null) return;
        if (state.busy === false && state.begin(npcKey) === null) return;
        Object.assign(state, { npcKey, offAim: false, resumed: false });
        if (state.before !== null) state.before.paused = w.disabled; // as it was before this pause
        // a follow runs on whilst they aim, else the view stops short. The view is ours from here
        if (w.view.follow === true) w.view.setFollow(false);
        w.setDisabled(true);
        // in to the near stop, slowly: a nudge past its commit, then it eases there of itself
        if (controls.zoomProgress < 1) {
          w.view.zoomInSlow = true;
          controls.addZoomProgress(npcFocusConfig.zoomNudge);
        }
        void w.view.lookAt(npc.point, {
          animate: true,
          ms: npcFocusConfig.zoomInMs,
          height: npc.position.y + npc.anim.headY * npcFocusConfig.heightOfHead,
        });
        w.view.forceUpdate(); // the paused indicator, hidden whilst open
        state.update();
      },
      place() {
        const npc = w.n?.[state.npcKey ?? ""];
        const camera = w.r3f?.camera;
        if (npc === undefined || camera === undefined || state.el === null) return;
        camera.updateMatrixWorld(); // as it is this frame, not the last
        const canvas = w.view.canvas.getBoundingClientRect();
        const box = state.el.getBoundingClientRect();
        /** Their middle on screen: each label goes on the side of it its part is */
        const middle = toScreen(bodyPartPoint(npc, "chest", tmpPoint), camera, canvas, box).x;
        for (const { part } of npcFocusParts) {
          const el = state.markEls[part];
          if (el == null) continue;
          const { x, y } = toScreen(bodyPartPoint(npc, npcFocusConfig.bones[part], tmpPoint), camera, canvas, box);
          const left = x < middle - 1;
          // written to the DOM, not rendered: once a frame, as the camera moves
          el.style.transform = `translate(${x}px,${y}px) translate(${left ? -100 : 0}%,-50%)`;
          el.style.flexDirection = left ? "row-reverse" : "row";
          el.style.visibility = "visible";
        }
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
      if (offAim !== state.offAim && state.el !== null) {
        // faded through the DOM, not rendered, as the frame loop finds it
        state.offAim = offAim;
        state.el.style.opacity = offAim ? "0" : "";
        state.el.inert = offAim;
      }
      if (offAim === false) state.place();
    });
    w.r3f?.invalidate(); // a first frame to place them in
    const sub = w.events.subscribe({
      next(e) {
        if (e.key !== "enabled" || state.resumed === true) return;
        state.set({ resumed: true }); // its note goes: Escape no longer ends this
      },
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribe();
      sub.unsubscribe();
    };
  }, [state.npcKey]);

  return (
    // faded out on closing. Only the marks take the pointer: the view is still the camera's to move
    <AnimatePresence>
      {state.npcKey !== null && (
        <motion.div
          key="npc-focus"
          className="pointer-events-none absolute inset-0 z-20 select-none overflow-hidden"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div ref={(el) => void (state.el = el)} className="absolute inset-0 transition-opacity duration-400">
            {npcFocusParts.map(({ part, label }, i) => (
              <button
                key={part}
                ref={(el) => void (state.markEls[part] = el)}
                type="button"
                className="group pointer-events-auto absolute top-0 left-0 flex items-center gap-1.5 font-mono text-[11px] text-white"
                style={{ visibility: "hidden" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  state.close(part);
                }}
              >
                <span className="size-3 shrink-0 rounded-full border border-white/80 bg-red-500/30 group-hover:bg-red-500" />
                <span className="rounded bg-black/60 px-1.5 py-0.5 opacity-80 group-hover:opacity-100">
                  {i + 1} {label}
                </span>
              </button>
            ))}
            {state.resumed === false && (
              <div className="absolute inset-x-0 top-3 flex justify-center">
                <button
                  type="button"
                  className="pointer-events-auto cursor-pointer rounded bg-black/60 px-2 py-0.5 font-mono text-[11px] text-white/80 hover:text-white"
                  onPointerDown={() => state.close(null)}
                >
                  Cancel (Esc) or continue (Enter)
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A world point's place in the overlay, in pixels */
function toScreen(point: THREE.Vector3, camera: THREE.Camera, canvas: DOMRect, box: DOMRect) {
  point.project(camera);
  return {
    x: canvas.left - box.left + ((point.x + 1) / 2) * canvas.width,
    y: canvas.top - box.top + ((1 - point.y) / 2) * canvas.height,
  };
}

const tmpPoint = new THREE.Vector3();

const npcFocusConfig = {
  /** Radians they may face away from whom it is open on, e.g. turned once the World runs on, before it is dismissed */
  maxOffAimRad: (15 * Math.PI) / 180,
  /** Milliseconds the view takes to pan in onto them, as it slowly zooms */
  zoomInMs: 1200,
  /** The most milliseconds the turn to them is waited on */
  turnMaxMs: 3000,
  /** The most milliseconds the phaser is then waited on to come up clear, before the choice is offered anyway */
  raiseMaxMs: 1500,
  /** Zoom progress nudged by, past the camera's commit, so it settles at the other stop */
  zoomNudge: 0.2,
  /** How far up to their head the view looks, `0` their feet */
  heightOfHead: 0.6,
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
  /** From the press until it is over, whilst `w.view.pausedHidden` */
  busy: boolean;
  /** They face more than `maxOffAimRad` away from them: the marks are hidden until they face back */
  offAim: boolean;
  /** The World has been resumed since it opened: then Escape only pauses it, and no longer ends this */
  resumed: boolean;
  /** The pause, follow and phaser to go back to */
  before: null | {
    paused: boolean;
    follow: boolean;
    /** Their phaser was up already, e.g. by `e`: it is left up after */
    raised: boolean;
  };
  el: null | HTMLDivElement;
  /** Each part's choice, placed by `place` */
  markEls: Partial<Record<FocusPart, null | HTMLButtonElement>>;
  /** Cancelled once it is over, which ends `aimAt` */
  task: null | Task;
  /** Gives up before it opens, the phaser left raised */
  abandon(): void;
  /** Raises the phaser and turns them to `npcKey`, then `open`s: resolved once it is over */
  aimAt(npcKey: string): Promise<void>;
  /** Notes the pause, follow and phaser to go back to: `null` if under way already, else its `task` */
  begin(npcKey: string): null | Task;
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
  /** They face more than `maxOffAimRad` away from whom it is open on */
  isOffAim(): boolean;
  /** Pauses, zooms in on them, and pins a choice over each part */
  open(npcKey: string): void;
  /** Each part's choice, pinned to where it is on screen now */
  place(): void;
};
