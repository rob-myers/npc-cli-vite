import { type UseStateRef, useStateRef } from "@npc-cli/util";
import { isTypingTarget } from "@npc-cli/util/legacy/dom";
import { error, warn } from "@npc-cli/util/legacy/generic";
import { deltaAngle } from "maath/misc";
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
      fireTouch: null,
      runTap: { code: "", ms: 0, on: false },
      lookAt: null,
      lookCap: null,
      lookMarked: true,
      cancelLook: () => {},
      doingUntil: 0,
      focus: false,
      focusYieldUntil: 0,
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
        /** Focus mode alone, which a held `r` overrides */
        const auto = state.focus === true && rHeld === false;
        // it yields to what they do of their own accord: a reach, a turn, a fade onto a seat (not off one)
        if (
          auto &&
          (w.e.handling.has(state.key) || face.turn !== null || (w.gameTime.now() < state.doingUntil && npc.isFading()))
        )
          state.focusYieldUntil = w.gameTime.now() + focusYieldSecs;
        /** `r` held, else focus mode unless it yields */
        const looking = rHeld || (state.focus && state.isFocusYielding() === false);
        const held = lookAt !== null || (looking && free);
        const { posture } = npc;
        if ((held === false || posture !== "stand") && face.aim === state.pointerAim) face.aim = null;
        /** Strafing, they keep their facing. Never over another's aim e.g. the phaser's */
        const keep = held === false && free && posture === "stand" && state.strafe;
        if (keep === false && face.aim === state.keepAim) face.aim = null;
        else if (keep === true && face.aim === null) face.aim = state.keepAim;
        if (held === false) return state.releaseLookCap(npc);
        if (lookAt !== null) {
          tmpHit.set(lookAt.x, 0, lookAt.y);
        } else {
          // focus mode keeps their facing whilst the camera is dragged
          if (rHeld === false && (w.view.controls?.pointers.length ?? 0) > 0) return;
          // measured on resize, not here: a rect read each tick may force a layout
          const { raycaster, lastPointer, bounds } = w.view;
          const { width, height } = bounds;
          tmpNdc.set((lastPointer.move.x / width) * 2 - 1, 1 - (lastPointer.move.y / height) * 2);
          raycaster.setFromCamera(tmpNdc, w.r3f.camera);
          // armed, at the gun's height: on someone, the pointer then aims through them, not at the floor beyond
          aimPlane.constant = w.phasers?.isArmed(state.key) === true ? -w.phasers.gunHeight(state.key) : 0;
          if (raycaster.ray.intersectPlane(aimPlane, tmpHit) === null) return;
        }
        tmpLook.x = tmpHit.x;
        tmpLook.y = tmpHit.z;
        const bearing = npc.anim.bearingOf(tmpLook);
        state.capFrontier(Math.hypot(tmpLook.x - npc.position.x, tmpLook.y - npc.position.z), bearing);
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
        state.pointerAim.at = w.phasers?.bearingFor(state.key, tmpLook) ?? bearing;
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
      cancelCharge() {
        return w.phasers?.cancelCharge(state.key) === true;
      },
      capFrontier(reach = doCapMetres, bearing) {
        const npc = state.get();
        if (npc === undefined) return;
        // reused, as a look sets it every tick
        const cap = (state.lookCap ??= { reach, bearing: null, x: 0, z: 0 });
        cap.reach = reach;
        cap.bearing = bearing ?? null;
        cap.x = npc.position.x;
        cap.z = npc.position.z;
      },
      dragLookTowards(clientX, clientY) {
        state.lookTowards(clientX, clientY);
        state.lookMarked = false;
      },
      dropFrontierCap() {
        state.lookCap = null;
        w.r3f?.invalidate(); // the frontier eases back out, and the bar's notice goes
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
      exists() {
        return w.n?.[state.key] !== undefined;
      },
      get() {
        return w.n?.[state.key];
      },
      is(npcKey) {
        return npcKey === state.key;
      },
      isDoubleTap(key, ms) {
        const double = ms - (state.tapMs[key] ?? -Infinity) < doubleTapMs;
        state.tapMs[key] = double ? -Infinity : ms; // a third is a fresh first
        return double;
      },
      isFocusYielding() {
        return w.gameTime.now() < state.focusYieldUntil;
      },
      lookAtPoint(x, z) {
        const npc = state.get();
        if (npc === undefined || w.client === true || w.disabled === true) return;
        if (Math.hypot(x - npc.position.x, z - npc.position.z) < lookDeadMetres) return;
        state.lookAt = { x, y: z };
        state.lookMarked = true;
        // held as `r` would be, long enough to come round
        state.cancelLook();
        state.cancelLook = w.e.after(lookHoldMs / 1000, () => {
          state.lookAt = null;
          w.r3f?.invalidate();
        });
        w.r3f?.invalidate();
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
      onFireTouch(e) {
        const fire = state.fireTouch;
        if (e.type === "touchstart" && e.touches.length === 1) {
          const { identifier, target } = e.touches[0];
          state.fireTouch =
            target === w.view.canvas ? { anchorId: identifier, downMs: e.timeStamp, shotId: null } : null;
          return false; // as yet a press like any other
        }
        if (fire === null) return false;
        if (e.type === "touchstart") {
          // a pinch, a third finger, or no phaser raised
          if (
            e.touches.length !== 2 ||
            e.timeStamp - fire.downMs < fireTouchDelayMs ||
            w.phasers?.isArmed(state.key) !== true
          )
            return false;
          fire.shotId = e.changedTouches[0].identifier;
          state.tap = null; // nor a look tap
          w.view.controls.holdTouch = true;
          state.startCharge(); // where they face
          return true;
        }
        const ended = (id: null | number) =>
          e.type === "touchcancel" || [...e.changedTouches].some((t) => t.identifier === id);
        const charging = fire.shotId !== null;
        // the second finger let go fires, even as the first does. The first alone cancels
        if (charging && e.type === "touchend" && ended(fire.shotId)) state.releaseCharge();
        else if (ended(fire.anchorId)) state.cancelCharge();
        else return false;
        fire.shotId = null;
        w.view.controls.holdTouch = false;
        if (ended(fire.anchorId)) state.fireTouch = null;
        return charging;
      },
      onKeyDown(e) {
        if (isTypingTarget(e) || e.repeat === true || w.client === true) return;
        // twice quickly toggles strafing, whatever else is held
        if (e.key === "Shift") return void (state.isDoubleTap("Shift", e.timeStamp) && state.toggleStrafe());
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.code === "Space") {
          e.preventDefault();
          return state.startCharge(); // fired on release: see `onKeyUp`
        }
        // a hand each: by `code`, so wherever a layout puts the letters
        if (moveCodes.has(e.code) === true) {
          // the same one twice, quickly, runs
          const tap = state.runTap;
          if (e.code === tap.code && e.timeStamp - tap.ms < doubleTapMs) state.setTapRun(true);
          return void Object.assign(tap, { code: e.code, ms: e.timeStamp });
        }
        if (e.code === "KeyC") {
          // twice quickly, a full crouch. Once: half from standing, else stood
          const anim = state.get()?.anim;
          if (state.isDoubleTap(e.code, e.timeStamp)) anim?.setCrouch(2);
          else anim?.setCrouch(anim.crouchLevel === 0 ? 1 : 0);
          return;
        }
        if (e.code === "KeyR") {
          // held: see `aimAtPointer`. Twice quickly starts focus mode, and once ends it
          if (state.focus === true || state.isDoubleTap(e.code, e.timeStamp)) state.toggleFocus();
          return void w.r3f?.invalidate();
        }
        if (e.code === "KeyQ") state.togglePsi();
        else if (e.code === "KeyE") {
          if (state.cancelCharge() === false) state.toggleArm(); // charging, it cancels that alone
        } else return;
        w.hud?.update();
        w.view.forceUpdate();
      },
      onKeyUp(e) {
        if (e.code === "Space") state.releaseCharge();
      },
      onTouch(e) {
        if (state.onFireTouch(e) === true) return; // the phaser's, not a look
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
      releaseCharge() {
        if (w.phasers?.isCharging(state.key) !== true) return;
        // paused, no shot leaves: it is called off instead
        if (w.disabled === true) state.cancelCharge();
        else w.npcFocus?.fire(state.key);
      },
      releaseLookCap(npc) {
        const cap = state.lookCap;
        // a fade's cap waits until they are shown: till then their head and place are the old ones
        if (cap === null || npc.isFading() || npc.anim.fadeState.target !== 1) return;
        const { x, z } = npc.position;
        const lookY = npc.lookY;
        if (cap.bearing === null) return void Object.assign(cap, { bearing: lookY, x, z });
        const moved = Math.hypot(x - cap.x, z - cap.z) > lookCapMetres;
        if (moved || Math.abs(deltaAngle(lookY, cap.bearing)) > lookCapRad) state.dropFrontierCap();
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
      setDoing(on) {
        state.doingUntil = on ? w.gameTime.now() + doingMaxSecs : 0;
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
      setTapRun(on) {
        const npc = state.get();
        // never over a run the bar's button began, which is its to end
        if (npc === undefined || on === state.runTap.on || (on === true && npc.anim.hurry === true)) return;
        state.runTap.on = on;
        npc.anim.setHurry(on);
        w.hud?.update();
      },
      setupDom() {
        const el = w.rootEl;
        const onKeyDown = (e: KeyboardEvent) => state.onKeyDown(e); // the latest, over hmr
        const onKeyUp = (e: KeyboardEvent) => state.onKeyUp(e);
        // a key released after focus has gone elsewhere never reaches `onKeyUp`
        const onBlur = () => state.cancelCharge();
        const onTouch = (e: TouchEvent) => state.onTouch(e);
        const touchTypes = ["touchstart", "touchend", "touchcancel"] as const;
        el.addEventListener("keydown", onKeyDown);
        el.addEventListener("keyup", onKeyUp);
        el.addEventListener("focusout", onBlur);
        window.addEventListener("blur", onBlur);
        // passive: we only watch, so scrolling and the camera never wait on us
        for (const type of touchTypes) el.addEventListener(type, onTouch, { passive: true });
        return () => {
          el.removeEventListener("keydown", onKeyDown);
          el.removeEventListener("keyup", onKeyUp);
          el.removeEventListener("focusout", onBlur);
          window.removeEventListener("blur", onBlur);
          for (const type of touchTypes) el.removeEventListener(type, onTouch);
          state.cancelLook();
        };
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
      startCharge() {
        const raised = w.phasers?.isArmed(state.key) === true;
        w.npcFocus?.target(state.key); // lowered, it is raised
        if (raised === true) w.phasers.charge(state.key); // not whilst cooling
      },
      stopLooking() {
        if (state.focus === true) state.toggleFocus();
        state.dropFrontierCap();
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
      toggleFocus() {
        state.focus = !state.focus;
        w.hud?.update(); // on, the bar keeps a notice of it
        w.view.update(); // and the cursor is a crosshair
        if (state.focus === false) w.hud?.say("focus off");
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
    }),
  );

  w.player = state;

  // `setupDom` is new on each hmr, so an edit to it re-adds the listeners
  useEffect(() => w.rootEl && state.setupDom(), [w.rootEl, state.setupDom]);
}

/** Where the pointer is taken to point: the floor, or the gun's height whilst armed */
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmpNdc = new THREE.Vector2();
const tmpHit = new THREE.Vector3();
/** Where they look on the floor, this tick */
const tmpLook = { x: 0, y: 0 };
/** A look tap's longest, second finger down to last up, and how far any finger may stray — as `isPointDiffDrag` */
const lookTapMs = 300;
/** A second press of the same move key within this is a double tap, which runs */
const doubleTapMs = 300;
const moveCodes = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]);
const lookTapSlopPx = 20;
/** On touch, a second finger this long after the first charges a raised phaser, rather than pinching */
const fireTouchDelayMs = 300;
/** How long a tap's look is held, as `r` would be */
const lookHoldMs = 1200;
/** Game seconds from `npc-pre-do` after which they are taken to have given up, should `npc-do` never come */
const doingMaxSecs = 3;
/** Game seconds focus mode waits after they are done with what it yielded to */
const focusYieldSecs = 0.8;
/** Metres from them within which a tap gives no direction to look */
const lookDeadMetres = 0.3;
/** Metres off that a tap past the horizon is taken to be */
const lookFarMetres = 500;
/** How far they walk before a look's cap on their frontier drops */
const lookCapMetres = 0.5;
/** How far they turn off a look's bearing before its cap drops */
const lookCapRad = Math.PI / 4;
/** The cap on their frontier as they take or leave a doable, which may face down a corridor */
const doCapMetres = 2;

export type State = {
  /** Key of the npc we consider the player — spawned on arrival if absent */
  key: string;

  /** Place the player if absent, then track them. `false` if they are not where the save left them */
  ensure(): Promise<boolean>;
  /** Whilst `r` is held, or `focus` is on, they face where the pointer meets the floor: or `lookAt`, whilst it is set. Each tick */
  aimAtPointer(): void;
  /** Focus mode: they face the pointer without `r` held. A double tap of `r` starts it, and a press ends it */
  focus: boolean;
  /** Game time until which they are about to sit or lie: focus mode yields to their fade onto it */
  doingUntil: number;
  /** From `npc-pre-do` until `npc-do`, or `doingMaxSecs` should that never come */
  setDoing(on: boolean): void;
  /** Game time until which focus mode yields to what they do themselves, e.g. putting a box down */
  focusYieldUntil: number;
  /** Focus mode is yielding: see `focusYieldUntil` */
  isFocusYielding(): boolean;
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
  /** On touch, a finger held down, and a second charging the player's phaser — see `onFireTouch` */
  fireTouch: null | { anchorId: number; downMs: number; shotId: null | number };
  /** Phaser raised, hold a finger, then a second charges and fires on release. True if the phaser's */
  onFireTouch(e: TouchEvent): boolean;
  /** The move key last pressed and when, and whether a double tap of one has them running */
  runTap: { code: string; ms: number; on: boolean };
  /** Starts or ends the run a double tap of `w`, `a`, `s` or `d` gives */
  setTapRun(on: boolean): void;
  /** Ends that run once its keys are let go, or cancel out. Each tick */
  syncRun(): void;
  /** The floor point a look (a right click or two-finger tap) is at, for `lookHoldMs` — see `LookMark` */
  lookAt: null | Geom.VectJson;
  /**
   * How far they last looked, which caps their frontier: from where, along which bearing.
   * It drops once they walk off or turn away
   */
  lookCap: null | { reach: number; bearing: null | number; x: number; z: number };
  /** Caps their frontier at `reach` along `bearing`, by default their facing once a fade is done, until they walk off or turn away */
  capFrontier(reach?: number, bearing?: number): void;
  /** Drops `lookCap` once they walk off or turn away. Each tick they are not looking */
  releaseLookCap(npc: JshCli.Npc): void;
  /** Their full frontier again: the walk off, or the turn away */
  dropFrontierCap(): void;
  /** Focus mode off and the cap dropped: the "x" of the bar's look or focus notice */
  stopLooking(): void;
  /** Whether `LookMark` shows `lookAt`: not whilst a finger drags it */
  lookMarked: boolean;
  /** Ends the look hold early, a game-time timer */
  cancelLook(): void;
  /** A two-finger tap on the canvas is a look where it lands */
  onTouch(e: TouchEvent): void;
  /** The player's npc, once they are spawned */
  get(): undefined | JshCli.Npc;
  exists(): boolean;
  /** Whether `npcKey` is the player */
  is(npcKey: string): boolean;
  /** Has them look where a point of the viewport meets the floor, as `r` does the pointer */
  lookTowards(clientX: number, clientY: number): void;
  /** The same, unmarked: a finger dragged whilst following is already on the spot */
  dragLookTowards(clientX: number, clientY: number): void;
  /** The same, to a world point */
  lookAtPoint(x: number, z: number): void;

  /** The player's controls: `q` psi, `e` held their phaser, a move key twice to run — the view's own keys are WorldView's */
  onKeyDown(e: KeyboardEvent): void;
  /** Space let go fires a charged shot */
  onKeyUp(e: KeyboardEvent): void;
  /** Raised, starts charging a shot, fired by `releaseCharge`. Lowered, raises it: Space, or the bar's fire button */
  startCharge(): void;
  /** Fires the shot charging: at whom its line crosses, else along it. Paused, cancels it */
  releaseCharge(): void;
  /** Ends a charge into a cooldown, the phaser left raised: `false` if none */
  cancelCharge(): boolean;
  /** Arms them, unlocks them if locked on, else disarms them — arming needs a phaser */
  toggleArm(): void;
  /** Focus mode on or off, saying so */
  toggleFocus(): void;
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
