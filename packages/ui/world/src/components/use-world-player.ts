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
      lookTimer: 0,
      psiLink: null,
      psiPolledAt: Number.NEGATIVE_INFINITY,

      aimAtPointer() {
        const npc = state.get();
        if (npc === undefined) return;
        const { face } = npc.anim;
        // not whilst locked on: the phaser's target is whom they face
        const free = w.phasers?.isLocked(state.key) !== true;
        const lookAt = free ? state.lookAt : null;
        const held = lookAt !== null || (w.view.keysDown.has("r") === true && free);
        const { posture } = npc;
        if ((held === false || posture !== "stand") && face.aim === pointerAim) face.aim = null;
        if (held === false || posture !== "sit") npc.anim.turnTo(null);
        if (held === false) return;
        if (lookAt !== null) {
          tmpHit.set(lookAt.x, 0, lookAt.y);
        } else {
          const { raycaster, lastPointer, canvas } = w.view;
          const { width, height } = canvas.getBoundingClientRect();
          tmpNdc.set((lastPointer.move.x / width) * 2 - 1, 1 - (lastPointer.move.y / height) * 2);
          raycaster.setFromCamera(tmpNdc, w.r3f.camera);
          if (raycaster.ray.intersectPlane(floorPlane, tmpHit) === null) return;
        }
        Object.assign(pointerAim.at, { x: tmpHit.x, y: tmpHit.z });
        w.r3f.invalidate(); // a held key draws nothing of itself
        // lain, they roll over to look
        if (posture === "lie") return void npc.anim.rollTo(pointerAim.at);
        // sat they do not turn round: their head, and a little of their torso
        if (posture === "sit") return void npc.anim.turnTo(pointerAim.at);
        // the aim's own ease alone, at rest too: a look for each shift of the pointer stuttered
        face.aim = pointerAim;
        if (npc.isMoving() === true) face.turn = null; // else a look landing mid-move idles them
      },
      assign(npcKey) {
        const prev = state.key;
        const changed = prev !== npcKey;
        if (changed === true) state.unlinkPsi();
        state.key = npcKey;
        // psi goes with the player, if the new one is granted it
        if (changed === true && w.e.isPsiRaised(prev) === true) {
          w.e.setPsi(false, prev);
          if (w.e.hasItem(npcKey, "psi") === true) w.e.setPsi(true, npcKey);
        }
        w.events.next({ key: "set-player", playerKey: npcKey });
        if (changed === true) w.view.onPlayerRespawn(); // one pan onto them, as a respawn is
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
      lookTowards(clientX, clientY) {
        const npc = state.get();
        // paused, the look would run out before they could turn
        if (npc === undefined || w.client === true || w.disabled === true) return;
        const rect = w.view.canvas.getBoundingClientRect();
        tmpNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2);
        w.view.raycaster.setFromCamera(tmpNdc, w.r3f.camera);
        const { origin, direction } = w.view.raycaster.ray;
        // on the floor they stand on. Past the horizon there is none: far off the way the tap looks, then
        const reach = direction.y < -1e-3 ? (npc.position.y - origin.y) / direction.y : lookFarMetres;
        tmpHit.copy(origin).addScaledVector(direction, Math.min(reach, lookFarMetres));
        state.lookAtPoint(tmpHit.x, tmpHit.z);
      },
      linkPsi(npcKey) {
        if (npcKey === state.key || w.n?.[npcKey] === undefined || state.psiLink === npcKey) return;
        state.unlinkPsi();
        // their breath alone: nothing an onlooker would see them do
        w.n[npcKey].anim.setBreathing(true);
        w.rings?.showSelectRing(npcKey, psiRingColor, "psi");
        state.psiLink = npcKey;
      },
      unlinkPsi() {
        const npcKey = state.psiLink;
        if (npcKey === null) return;
        state.psiLink = null;
        w.n?.[npcKey]?.anim.setBreathing(false);
        w.rings?.hideSelectRing(npcKey, "psi");
      },
      syncPsiLink() {
        const npc = state.get();
        if (npc === undefined || w.client === true || w.e.isPsiRaised() === false) return state.unlinkPsi();
        const now = w.timer.getElapsedTime();
        // looked for now and then, a new timer aside
        if (now - state.psiPolledAt < psiPollSecs && now >= state.psiPolledAt) return;
        state.psiPolledAt = now;
        const found = findPsiTarget(w, npc);
        if (found === undefined) state.unlinkPsi();
        else state.linkPsi(found.key);
      },
      takePsi() {
        const [npc, npcKey] = [state.get(), state.psiLink];
        // found afresh, as the link may be a second old
        if (npc === undefined || npcKey === null || findPsiTarget(w, npc)?.key !== npcKey) return false;
        state.unlinkPsi();
        w.e.giveItem(npcKey, "psi");
        state.setKey(npcKey);
        return true;
      },
      lookAtPoint(x, z) {
        const npc = state.get();
        if (npc === undefined || w.client === true || w.disabled === true) return;
        if (Math.hypot(x - npc.position.x, z - npc.position.z) < lookDeadMetres) return;
        state.lookAt = { x, y: z };
        // held as `r` would be, long enough to come round
        window.clearTimeout(state.lookTimer);
        state.lookTimer = window.setTimeout(() => {
          state.lookAt = null;
          w.r3f?.invalidate();
        }, lookHoldMs);
        w.r3f?.invalidate();
      },
      onKeyDown(e) {
        if (isTypingTarget(e) || e.repeat === true || w.client === true) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        // a hand each: by `code`, so wherever a layout puts the letters
        if (moveCodes.has(e.code) === true) {
          // the same one twice, quickly, runs
          const tap = state.runTap;
          if (e.code === tap.code && e.timeStamp - tap.ms < doubleTapMs) state.setTapRun(true);
          return void Object.assign(tap, { code: e.code, ms: e.timeStamp });
        }
        if (e.code === "KeyR") return void w.r3f?.invalidate(); // held: see `aimAtPointer`
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
      togglePsi() {
        if (state.exists() === false) return;
        const on = w.e.isPsiRaised(state.key);
        if (on === false && w.e.hasItem(state.key, "psi") === false) return;
        // beside the one linked it takes them, rather than lowering it
        if (state.takePsi() === false) w.e.setPsi(!on, state.key);
      },
      toggleRun() {
        const npc = state.get();
        npc?.anim.setHurry(!npc.anim.hurry);
        state.runTap.on = false; // theirs now, to end as they began it
        w.hud?.update();
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
          window.clearTimeout(state.lookTimer);
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

  useEffect(() => w.rootEl && state.setupDom(), [w.rootEl]);
}

/** The aim `aimAtPointer` gives the player: ours alone to clear */
const pointerAim = { at: { x: 0, y: 0 }, rate: 1, untilRest: false };
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmpNdc = new THREE.Vector2();
const tmpHit = new THREE.Vector3();
/** Metres within which the player's psi links to another, who can then be taken */
const psiLinkMetres = 3;
/** Seconds between looks for whom that is */
const psiPollSecs = 1;
/** Metres nearer the one already linked counts as, so two alike do not swap back and forth */
const psiKeepMetres = 0.4;
/** The ring under the one linked */
const psiRingColor = "#ffffff";

/** Whom psi links to: the nearest of those they could walk to, in range. One already linked is kept over another much the same */
function findPsiTarget(w: UseStateRef<WorldState>, npc: JshCli.Npc) {
  let [best, bestDist] = [undefined as undefined | JshCli.Npc, Number.POSITIVE_INFINITY];
  for (const other of w.e.getNpcsInReach(npc.key)) {
    const dist = Math.hypot(other.position.x - npc.position.x, other.position.z - npc.position.z);
    if (dist > psiLinkMetres) continue;
    const counted = dist - (other.key === w.player.psiLink ? psiKeepMetres : 0);
    if (counted < bestDist) [best, bestDist] = [other, counted];
  }
  return best;
}
/** A look tap's longest, second finger down to last up, and how far any finger may stray — as `isPointDiffDrag` */
const lookTapMs = 300;
/** A second press of the same move key within this is a double tap, which runs */
const doubleTapMs = 300;
const moveCodes = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);
const lookTapSlopPx = 20;
/** How long a tap's look is held, as `r` would be */
const lookHoldMs = 1200;
/** Metres from them within which a tap gives no direction to look */
const lookDeadMetres = 0.3;
/** Metres off that a tap past the horizon is taken to be */
const lookFarMetres = 500;

export type State = {
  /** Key of the npc we consider the player — spawned on arrival if absent */
  key: string;

  /** Place the player if absent, then track them. `false` if they are not where the save left them */
  ensure(): Promise<boolean>;
  /** Whilst `r` is held they face where the pointer meets the floor, eased round by `face.aim`: or `lookAt`, whilst it is set */
  aimAtPointer(): void;
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
  lookTimer: number;
  /** A two-finger tap on the canvas has them look where it lands */
  onTouch(e: TouchEvent): void;
  /** The player's npc, once they are spawned */
  get(): undefined | JshCli.Npc;
  exists(): boolean;
  /** Has them look where a point of the viewport meets the floor, as `r` does the pointer */
  lookTowards(clientX: number, clientY: number): void;
  /** The same, to a world point */
  lookAtPoint(x: number, z: number): void;
  /** The npc the player's psi is linked to, whom `q` would take — see `docs/psi.md` */
  psiLink: null | string;
  /** When whom to link to was last looked for, in world seconds */
  psiPolledAt: number;
  /** Links the player's psi to them: their breath shows, and a ring under them */
  linkPsi(npcKey: string): void;
  /** Lets go of whom they are linked to: their breath and ring go */
  unlinkPsi(): void;
  /** Psi raised, links to the nearest in reach, looked for every `psiPollSecs`. Each tick */
  syncPsiLink(): void;
  /** Makes whom they are linked to the player, if still the nearest in range — `false` otherwise */
  takePsi(): boolean;

  /** The player's controls: `q` psi, `e` their phaser, a move key twice to run — the view's own keys are WorldView's */
  onKeyDown(e: KeyboardEvent): void;
  /** Arms them, unlocks them if locked on, else disarms them — arming needs a phaser */
  toggleArm(): void;
  /** Run or walk — their `anim.hurry` */
  toggleRun(): void;
  /** Psi off, else on — on needs psi */
  togglePsi(): void;
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
  assign(npcKey: string): void;
  setKey(npcKey: string): void;
  /** Listens on the World's root for the player's keys and taps, returning the cleanup */
  setupDom(): () => void;
  /** Spawns the player in a random room, preferring `spawnRoomLabels` — `false` if every attempt failed */
  spawnSomewhere(): Promise<boolean>;
};
