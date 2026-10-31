import { type UseStateRef, useStateRef } from "@npc-cli/util";
import { isTypingTarget } from "@npc-cli/util/legacy/dom";
import { error, warn } from "@npc-cli/util/legacy/generic";
import { useEffect } from "react";
import * as THREE from "three/webgpu";
import { defaultPlayerKey, spawnPlayerAttempts, spawnRoomLabels } from "../const.env";
import { getWorldMapStore } from "../service/storage";
import type { State as WorldState } from "./World";

/**
 * The player of a World: which npc they are, where they appear on
 * arriving at a map, and the "intro" i.e. panning the camera onto them.
 *
 * Their per-map position is persisted alongside every other npc — see
 * `w.e.persistNpcs`.
 */
export default function useWorldPlayer(w: UseStateRef<WorldState>) {
  const state = useStateRef(
    (): State => ({
      key: defaultPlayerKey,
      tap: null,
      runTap: { code: "", ms: 0, on: false },
      lookAt: null,
      cancelLook: () => {},
      look: false,
      lookYieldUntil: 0,
      strafe: false,
      tapMs: {},
      keepAim: { at: 0, rate: 0, untilRest: false },
      pointerAim: { at: 0, rate: 1, untilRest: false },

      aimAtPointer() {
        const npc = state.get();
        if (npc === undefined) return;
        const { face } = npc.anim;
        // not whilst locked on: the phaser's target is whom they face
        const free = w.phasers?.isLocked(state.key) !== true;
        const lookAt = free ? state.lookAt : null;
        const rHeld = w.view.keysDown.has("r") === true;
        /** Look mode alone, which a held `r` overrides */
        const auto = state.look === true && rHeld === false;
        // it yields to what they do of their own accord: a reach, a turn, a fade onto a seat
        if (auto && (w.e.handling.has(state.key) || face.turn !== null || npc.isFading()))
          state.lookYieldUntil = w.gameTime.now() + lookYieldSecs;
        const held = lookAt !== null || ((rHeld || (state.look && state.isLookYielding() === false)) && free);
        const { posture } = npc;
        if ((held === false || posture !== "stand") && face.aim === state.pointerAim) face.aim = null;
        /** Strafing, they keep their facing. Never over another's aim e.g. the phaser's */
        const keep = held === false && free && posture === "stand" && state.strafe;
        if (keep === false && face.aim === state.keepAim) face.aim = null;
        else if (keep === true && face.aim === null) face.aim = state.keepAim;
        if (held === false) return;
        if (lookAt !== null) {
          tmpHit.set(lookAt.x, 0, lookAt.y);
        } else {
          // look mode keeps their facing whilst the camera is dragged
          if (rHeld === false && (w.view.controls?.pointers.length ?? 0) > 0) return;
          // measured on resize, not here: a rect read each tick may force a layout
          const { raycaster, lastPointer, bounds } = w.view;
          const { width, height } = bounds;
          tmpNdc.set((lastPointer.move.x / width) * 2 - 1, 1 - (lastPointer.move.y / height) * 2);
          raycaster.setFromCamera(tmpNdc, w.r3f.camera);
          if (raycaster.ray.intersectPlane(floorPlane, tmpHit) === null) return;
        }
        tmpLook.x = tmpHit.x;
        tmpLook.y = tmpHit.z;
        w.r3f.invalidate(); // a held key draws nothing of itself
        if (posture === "lie") {
          // lain, they roll over and lift their head to look, held there once let go: armed, they point there instead
          if (w.phasers?.isArmed(state.key) === true) return w.phasers.pointAt(state.key, tmpLook);
          return void npc.anim.lookLain(tmpLook);
        }
        if (posture === "sit") {
          w.phasers?.pointAt(state.key, tmpLook); // armed, the arm goes with them
          // sat they do not turn round: their head, and a little of their torso
          return void npc.anim.turnTo(tmpLook);
        }
        // armed, their muzzle's line through it rather than their middle
        state.pointerAim.at = w.phasers?.bearingFor(state.key, tmpLook) ?? npc.anim.bearingOf(tmpLook);
        // the aim's own ease alone, at rest too: a look for each shift of the pointer stuttered
        face.aim = state.pointerAim;
        if (npc.isMoving() === true) face.turn = null; // else a look landing mid-move idles them
      },
      assign(npcKey, { pan = true } = {}) {
        const prev = state.key;
        const changed = prev !== npcKey;
        state.key = npcKey;
        if (changed === true) {
          // the player's label is drawn bolder than anyone else's — see `Npc.drawLabel`
          w.n?.[prev]?.drawLabel();
          w.n?.[npcKey]?.drawLabel();
        }
        // psi goes with the player, if the new one is granted it
        if (changed === true && w.e.isPsiRaised(prev) === true) {
          w.e.setPsi(false, prev);
          if (w.e.hasItem(npcKey, "psi") === true) w.e.setPsi(true, npcKey);
        }
        w.events.next({ key: "set-player", playerKey: npcKey });
        if (changed === true && pan === true) w.view.onPlayerRespawn(); // one pan onto them, as a respawn is
      },
      async ensure() {
        let restored = true; // already present: they are where we left them
        if (state.exists() === false) {
          // a map keeps its own player position, so returning to it puts them back where they
          // were. A map we have never stood on starts them at one of its spawn points
          restored = await state.restore();
          const placed = restored || (await state.restoreFromSpawnPoint()) || (await state.spawnSomewhere());
          if (placed === false) warn(`player ${state.key}: nowhere to spawn on map ${w.mapKey}`);
        }
        return restored;
      },
      get() {
        return w.n?.[state.key];
      },
      exists() {
        return w.n?.[state.key] !== undefined;
      },
      is(npcKey) {
        return npcKey === state.key;
      },
      isLookYielding() {
        return w.gameTime.now() < state.lookYieldUntil;
      },
      isDoubleTap(key, ms) {
        const double = ms - (state.tapMs[key] ?? -Infinity) < doubleTapMs;
        state.tapMs[key] = double ? -Infinity : ms; // a third is a fresh first
        return double;
      },
      lookTowards(clientX, clientY) {
        const npc = state.get();
        // paused, the look would run out before they could turn
        if (npc === undefined || w.client === true || w.disabled === true) return;
        const rect = w.view.canvas.getBoundingClientRect();
        tmpNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2);
        w.view.raycaster.setFromCamera(tmpNdc, w.r3f.camera);
        const { origin, direction } = w.view.raycaster.ray;
        // on the floor, not at their own height: sat or lain they are off it. Past the horizon there is none: far off the way the tap looks, then
        const reach = direction.y < -1e-3 ? -origin.y / direction.y : lookFarMetres;
        tmpHit.copy(origin).addScaledVector(direction, Math.min(reach, lookFarMetres));
        state.lookAtPoint(tmpHit.x, tmpHit.z);
      },
      lookAtPoint(x, z) {
        const npc = state.get();
        if (npc === undefined || w.client === true || w.disabled === true) return;
        if (Math.hypot(x - npc.position.x, z - npc.position.z) < lookDeadMetres) return;
        state.lookAt = { x, y: z };
        // held as `r` would be, long enough to come round
        state.cancelLook();
        state.cancelLook = w.e.after(lookHoldMs / 1000, () => {
          state.lookAt = null;
          w.r3f?.invalidate();
        });
        w.r3f?.invalidate();
      },
      onKeyDown(e) {
        if (isTypingTarget(e) || e.repeat === true || w.client === true) return;
        // twice quickly toggles strafing, whatever else is held
        if (e.key === "Shift") return void (state.isDoubleTap("Shift", e.timeStamp) && state.toggleStrafe());
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.code === "Space") {
          // raised, it fires at whom its line crosses, else along it. Lowered, it is raised
          e.preventDefault();
          const raised = w.phasers?.isArmed(state.key) === true;
          w.npcFocus?.target(state.key);
          if (raised === true) w.npcFocus?.fire(state.key);
          return;
        }
        // a hand each: by `code`, so wherever a layout puts the letters
        if (moveCodes.has(e.code) === true) {
          // the same one twice, quickly, runs
          const tap = state.runTap;
          if (e.code === tap.code && e.timeStamp - tap.ms < doubleTapMs) state.setTapRun(true);
          return void Object.assign(tap, { code: e.code, ms: e.timeStamp });
        }
        if (e.code === "KeyC") {
          // twice quickly, a full crouch. Once: half from standing or full, else stood
          const anim = state.get()?.anim;
          if (state.isDoubleTap(e.code, e.timeStamp)) anim?.setCrouch(2);
          else anim?.setCrouch(anim.crouchLevel === 1 ? 0 : 1);
          return;
        }
        if (e.code === "KeyR") {
          // held: see `aimAtPointer`. Twice quickly starts look mode, and once ends it
          if (state.look === true || state.isDoubleTap(e.code, e.timeStamp)) state.toggleLook();
          return void w.r3f?.invalidate();
        }
        if (e.code === "KeyQ") state.togglePsi();
        else if (e.code === "KeyE") state.toggleArm();
        else return;
        w.hud?.update();
        w.view.forceUpdate();
      },
      onTouch(e) {
        if (e.type === "touchstart") {
          const [a, b, c] = e.touches; // a second finger begins one, a third ends it
          const onCanvas = a?.target === w.view.canvas && b?.target === w.view.canvas;
          state.tap = onCanvas && c === undefined ? { startMs: e.timeStamp, downs: [a, b] } : null;
          return;
        }
        const { tap } = state;
        if (tap === null) return;
        const strayed = [...e.changedTouches].some((touch) => {
          const down = tap.downs.find((d) => d.identifier === touch.identifier);
          return (
            down === undefined || Math.hypot(touch.clientX - down.clientX, touch.clientY - down.clientY) > lookTapSlopPx
          );
        });
        if (e.type === "touchcancel" || strayed || e.timeStamp - tap.startMs > lookTapMs) {
          state.tap = null;
        } else if (e.touches.length === 0) {
          state.tap = null;
          const [a, b] = tap.downs;
          state.lookTowards((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        }
      },
      async panTo({ animate = true } = {}) {
        const npc = state.get();
        if (npc === undefined) return;

        // no `radius`, so this pans and turns without zooming — `lookAt` keeps the distance it
        // finds, which on load is whatever view we restored
        await w.view.lookAt(npc.point, {
          animate,
          // they walk whilst we pan, and the point of it is to be ON them — a destination fixed at
          // the moment of the press lands behind
          track: () => state.get()?.point,
        });
      },
      persist() {
        w.e.persistNpcs();
        w.e.persistDecor();
      },
      psi(on) {
        w.e.setPsi(on, state.key);
      },
      async restore() {
        const saved = getWorldMapStore(w.key, w.mapKey)
          .read()
          .npcs?.npcs.find((x) => x.key === state.key);
        if (saved === undefined) {
          return false;
        }

        try {
          // the usual spawn, so e.g. colliders are triggered
          await w.npc.spawn({
            npcKey: state.key,
            // the decor meta re-establishes what they were doing e.g. sitting
            at: { ...saved.at, meta: saved.decorKey ? w.decor.byKey[saved.decorKey]?.meta : undefined },
            angle: saved.angle,
            as: saved.skinKey,
          });
          w.e.restoreAccess(saved);
          return true;
        } catch (e) {
          error(e); // e.g. no longer placable
          return false;
        }
      },
      async restoreFromSpawnPoint() {
        const points = Object.values(w.decor.byKey).filter(
          (decor): decor is Geomorph.DecorPoint => decor.type === "point" && decor.meta.spawn === true,
        );
        const point = points[Math.floor(Math.random() * points.length)];
        if (point === undefined) {
          return false; // a map without spawn points
        }
        // facing the point's direction, as `determineSpawnedAngle` reads `meta.orient`
        const angle = -(point.orient + 90) * (Math.PI / 180);
        await w.npc.spawn({ npcKey: state.key, at: { x: point.x, y: point.y }, angle });
        return true;
      },
      setTapRun(on) {
        const npc = state.get();
        // never over a run the bar's button began, which is its to end
        if (npc === undefined || on === state.runTap.on || (on === true && npc.anim.hurry === true)) return;
        state.runTap.on = on;
        npc.anim.setHurry(on);
        w.hud?.update();
      },
      syncRun() {
        // none held, or opposites: either way they are no longer going anywhere
        if (state.runTap.on === true && w.view.getWasdDirection().length === 0) state.setTapRun(false);
      },
      toggleArm() {
        if (state.exists() === false || w.phasers === null) return;
        // holstering needs no phaser
        if (w.phasers.isArmed(state.key) === false && w.e.hasItem(state.key, "phaser") === false) return;
        if (w.phasers.isLocked(state.key))
          w.phasers.arm(state.key); // lets go of them first, still drawn
        else w.phasers.toggle(state.key);
      },
      toggleLook() {
        state.look = !state.look;
        w.hud?.update(); // on, the bar keeps a notice of it
        w.view.update(); // and the cursor is a crosshair
        if (state.look === false) w.hud?.say("look off");
        w.r3f?.invalidate();
      },
      togglePsi() {
        if (state.exists() === false) return;
        const on = w.e.isPsiRaised(state.key);
        if (on === false && w.e.hasItem(state.key, "psi") === false) return;
        w.e.setPsi(!on, state.key);
      },
      toggleRun() {
        const npc = state.get();
        npc?.anim.setHurry(!npc.anim.hurry);
        state.runTap.on = false; // theirs now, to end as they began it
        w.hud?.update();
        w.hud?.say(npc?.anim.hurry === true ? "run" : "walk");
      },
      toggleStrafe() {
        // aiming strafes them regardless, and sat or lain they never do
        if (w.phasers?.isArmed(state.key) === true || state.get()?.posture !== "stand") return;
        state.strafe = !state.strafe;
        w.hud?.update(); // its gait button shows it
        if (state.strafe === false) w.hud?.say("strafe off"); // on, the bar keeps a notice of it
        w.r3f?.invalidate();
      },
      setupDom() {
        const el = w.rootEl;
        const onKeyDown = (e: KeyboardEvent) => state.onKeyDown(e); // the latest, over hmr
        const onTouch = (e: TouchEvent) => state.onTouch(e);
        const touchTypes = ["touchstart", "touchend", "touchcancel"] as const;
        el.addEventListener("keydown", onKeyDown);
        // passive: we only watch, so scrolling and the camera never wait on us
        for (const type of touchTypes) el.addEventListener(type, onTouch, { passive: true });
        return () => {
          el.removeEventListener("keydown", onKeyDown);
          for (const type of touchTypes) el.removeEventListener(type, onTouch);
          state.cancelLook();
        };
      },
      setKey(npcKey) {
        if (npcKey === state.key || w.n[npcKey] === undefined) {
          return;
        }
        w.e.setNpcLit(w.n[npcKey], false);
        state.assign(npcKey);
        state.update();
        // retargets the dynamic light, snapping it so it shows whilst paused
        state.persist();
        // a follow has its own pan, begun by `assign`
        if (w.view.getFollowedPlayer() === undefined) void state.panTo(); // as on load
      },
      async spawnSomewhere() {
        // the rooms labelled by `spawnRoomLabels`, judged by their labelling decor point
        const labelled = Object.values(w.decor.byKey).flatMap((decor) =>
          w.helper.isRoomLabel(decor) && spawnRoomLabels.includes(decor.meta.label) ? [decor.meta] : [],
        );
        // a map may label no room at all e.g. a bare playground hull — then any room will do
        const rooms =
          labelled.length > 0 ? labelled : w.gms.flatMap((gm, gmId) => gm.rooms.map((_, roomId) => ({ gmId, roomId })));
        for (let attempt = 0; attempt < spawnPlayerAttempts; attempt++) {
          const { gmId, roomId } = rooms[Math.floor(Math.random() * rooms.length)] ?? {};
          const gm = w.gms[gmId as number];
          const room = gm?.rooms[roomId as number];
          if (room === undefined) {
            break; // no such rooms
          }

          try {
            await w.npc.spawn({ npcKey: state.key, at: gm.matrix.transformPoint({ ...room.center }) });
            return true;
          } catch (e) {
            error(e); // e.g. "not placable": try another room
          }
        }
        return false;
      },
    }),
  );

  w.player = state;

  // `setupDom` is new on each hmr, so an edit to it re-adds the listeners
  useEffect(() => w.rootEl && state.setupDom(), [w.rootEl, state.setupDom]);
}

const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmpNdc = new THREE.Vector2();
const tmpHit = new THREE.Vector3();
/** Where they look on the floor, this tick */
const tmpLook = { x: 0, y: 0 };
/** A look tap's longest, second finger down to last up, and how far any finger may stray — as `isPointDiffDrag` */
const lookTapMs = 300;
/** A second press of the same move key within this is a double tap, which runs */
const doubleTapMs = 300;
const moveCodes = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);
const lookTapSlopPx = 20;
/** How long a tap's look is held, as `r` would be */
const lookHoldMs = 1200;
/** Game seconds look mode waits after they are done with what it yielded to */
const lookYieldSecs = 0.8;
/** Metres from them within which a tap gives no direction to look */
const lookDeadMetres = 0.3;
/** Metres off that a tap past the horizon is taken to be */
const lookFarMetres = 500;

export type State = {
  /** Key of the npc we consider the player — spawned on arrival if absent */
  key: string;

  /** Place the player if absent, then track them. `false` if they are not where the save left them */
  ensure(): Promise<boolean>;
  /** Whilst `r` is held, or `look` is on, they face where the pointer meets the floor: or `lookAt`, whilst it is set. Each tick */
  aimAtPointer(): void;
  /** Look mode: they face the pointer without `r` held. A double tap of `r` starts it, and a press ends it */
  look: boolean;
  /** Game time until which look mode yields to what they do themselves, e.g. putting a box down */
  lookYieldUntil: number;
  /** Look mode is yielding: see `lookYieldUntil` */
  isLookYielding(): boolean;
  /** Whilst on they keep their facing, so a move strafes, at a walk. A double tap of Shift toggles it */
  strafe: boolean;
  /** When each key last went down, for its double tap */
  tapMs: Record<string, number>;
  /** Whether a press at `ms` follows one of the same key within `doubleTapMs` */
  isDoubleTap(key: string, ms: number): boolean;
  /** The aim strafing gives the player: at `rate` `0` it turns them not at all. Ours alone to clear, so kept over hmr */
  keepAim: { at: number; rate: number; untilRest: boolean };
  /** The aim `aimAtPointer` gives the player. Ours alone to clear, so kept over hmr */
  pointerAim: { at: number; rate: number; untilRest: boolean };
  /** Two fingers down on the canvas that may yet be a look tap: since when, and where */
  tap: null | { startMs: number; downs: [Touch, Touch] };
  /** The move key last pressed and when, and whether a double tap of one has them running */
  runTap: { code: string; ms: number; on: boolean };
  /** Starts or ends the run a double tap of `w`, `a`, `s` or `d` gives */
  setTapRun(on: boolean): void;
  /** Ends that run once its keys are let go, or cancel out. Each tick */
  syncRun(): void;
  /** The floor point a tap has them look at, for `lookHoldMs` — see `LookMark` */
  lookAt: null | Geom.VectJson;
  /** Ends the look hold early, a game-time timer */
  cancelLook(): void;
  /** A two-finger tap on the canvas has them look where it lands */
  onTouch(e: TouchEvent): void;
  /** The player's npc, once they are spawned */
  get(): undefined | JshCli.Npc;
  exists(): boolean;
  /** Whether `npcKey` is the player */
  is(npcKey: string): boolean;
  /** Has them look where a point of the viewport meets the floor, as `r` does the pointer */
  lookTowards(clientX: number, clientY: number): void;
  /** The same, to a world point */
  lookAtPoint(x: number, z: number): void;

  /** The player's controls: `q` psi, `e` held their phaser, a move key twice to run — the view's own keys are WorldView's */
  onKeyDown(e: KeyboardEvent): void;
  /** Arms them, unlocks them if locked on, else disarms them — arming needs a phaser */
  toggleArm(): void;
  /** Look mode on or off, saying so */
  toggleLook(): void;
  /** Run or walk — their `anim.hurry` — saying so */
  toggleRun(): void;
  /** Psi off, else on — on needs psi */
  togglePsi(): void;
  /** Strafing or not, saying so. Not whilst aiming, which strafes them */
  toggleStrafe(): void;
  /** Pans the camera onto the player, or snaps when `animate` is false */
  panTo(opts?: { animate?: boolean }): Promise<void>;
  /** Saves every npc for `w.mapKey` — see `w.e.persistNpcs` */
  persist(): void;
  /** Psi on or off, granted or not. See `Psi` */
  psi(on: boolean): void;
  /** Respawns the player where they were on this map — `false` if we couldn't */
  restore(): Promise<boolean>;
  /** Spawns the player at one of the map's `meta.spawn` decor points, at random — `false` if it has none */
  restoreFromSpawnPoint(): Promise<boolean>;
  /** Make `npcKey` the player, retargeting the dynamic light and panning. No-op if absent */
  /** Make them the player, telling everyone — the bare act, without `setKey`'s lit, persist and pan */
  assign(npcKey: string, opts?: { pan?: boolean }): void;
  setKey(npcKey: string): void;
  /** Listens on the World's root for the player's keys and taps, returning the cleanup */
  setupDom(): () => void;
  /** Spawns the player in a random room, preferring `spawnRoomLabels` — `false` if every attempt failed */
  spawnSomewhere(): Promise<boolean>;
};
