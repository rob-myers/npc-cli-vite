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
      twoTap: null,

      async ensure() {
        let restored = true; // already present: they are where we left them
        if (w.n[state.key] === undefined) {
          // a map keeps its own player position, so returning to it puts them back where they
          // were. A map we have never stood on starts them at one of its spawn points
          restored = await state.restore();
          const placed = restored || (await state.restoreFromSpawnPoint()) || (await state.spawnSomewhere());
          if (placed === false) warn(`player ${state.key}: nowhere to spawn on map ${w.mapKey}`);
        }
        return restored;
      },
      onKeyDown(e) {
        if (isTypingTarget(e) || e.repeat === true || w.client === true) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        // a hand each: by `code`, so wherever a layout puts the letters
        if (e.code === "KeyR") return void w.r3f?.invalidate(); // held: see `aimAtPointer`
        if (e.code === "KeyQ") state.togglePsi();
        else if (e.code === "KeyE") state.toggleArm();
        else if (e.code === "KeyF") state.toggleRun();
        else return;
        w.hud?.update();
        w.view.forceUpdate();
      },
      aimAtPointer() {
        const npc = w.n?.[state.key];
        if (npc === undefined) return;
        const { face } = npc.anim;
        // not whilst locked on: the phaser's target is whom they face
        if (w.view.keysDown.has("r") === false || w.phasers?.isLocked(state.key) === true) {
          if (face.aim === pointerAim) face.aim = null;
          return;
        }
        const { raycaster, lastPointer, canvas } = w.view;
        const { width, height } = canvas.getBoundingClientRect();
        tmpNdc.set((lastPointer.move.x / width) * 2 - 1, 1 - (lastPointer.move.y / height) * 2);
        raycaster.setFromCamera(tmpNdc, w.r3f.camera);
        if (raycaster.ray.intersectPlane(floorPlane, tmpHit) === null) return;
        Object.assign(pointerAim.at, { x: tmpHit.x, y: tmpHit.z });
        // the aim's own ease alone, at rest too: a look for each shift of the pointer stuttered
        face.aim = pointerAim;
        if (npc.isMoving() === true) face.turn = null; // else a look landing mid-move idles them
        w.r3f.invalidate(); // a held key draws nothing of itself
      },
      onTouch(e) {
        if (e.type === "touchstart") {
          const [a, b, c] = e.touches; // a second finger begins one, a third ends it
          const onCanvas = a?.target === w.view.canvas && b?.target === w.view.canvas;
          state.twoTap = onCanvas && c === undefined ? { startMs: e.timeStamp, downs: [a, b] } : null;
          return;
        }
        const tap = state.twoTap;
        if (tap === null) return;
        const strayed = [...e.changedTouches].some((t) => {
          const down = tap.downs.find((d) => d.identifier === t.identifier);
          return down === undefined || Math.hypot(t.clientX - down.clientX, t.clientY - down.clientY) > twoTapSlopPx;
        });
        if (e.type === "touchcancel" || strayed || e.timeStamp - tap.startMs > twoTapMs) state.twoTap = null;
        else if (e.touches.length === 0) {
          state.twoTap = null;
          const { left, width } = w.view.canvas.getBoundingClientRect();
          (tap.downs[0].clientX + tap.downs[1].clientX) / 2 < left + width / 2 ? state.togglePsi() : state.toggleArm();
        }
      },
      toggleArm() {
        if (w.n?.[state.key] === undefined || w.phasers === null) return;
        // holstering needs no phaser
        if (w.phasers.isArmed(state.key) === false && w.e.hasItem(state.key, "phaser") === false) return;
        if (w.phasers.isLocked(state.key))
          w.phasers.arm(state.key); // lets go of them first, still drawn
        else w.phasers.toggle(state.key);
      },
      toggleRun() {
        const npc = w.n?.[state.key];
        npc?.anim.setHurry(!npc.anim.hurry);
        w.hud?.update();
      },
      togglePsi() {
        if (w.n?.[state.key] === undefined || w.psi === null) return;
        if (w.psi.getTarget() === null && w.e.hasItem(state.key, "psi") === false) return;
        w.psi.toggle();
      },
      async panTo({ animate = true } = {}) {
        const npc = w.n[state.key];
        if (npc === undefined) return;

        // no `radius`, so this pans and turns without zooming — `lookAt` keeps the distance it
        // finds, which on load is whatever view we restored
        await w.view.lookAt(npc.point, {
          animate,
          // they walk whilst we pan, and the point of it is to be ON them — a destination fixed at
          // the moment of the press lands behind
          track: () => w.n[state.key]?.point,
        });
      },
      psi(npcKey) {
        if (npcKey !== null) w.npc.get(npcKey); // throws for an unknown npc
        w.psi.choose(npcKey);
      },
      persist() {
        w.e.persistNpcs();
        w.e.persistDecor();
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
      assign(npcKey) {
        state.key = npcKey;
        w.events.next({ key: "set-player", playerKey: npcKey });
      },
      setupDom() {
        const el = w.rootEl;
        const onKeyDown = (e: KeyboardEvent) => state.onKeyDown(e); // the latest, over hmr
        const onTouch = (e: TouchEvent) => state.onTouch(e);
        const touchTypes = ["touchstart", "touchend", "touchcancel"] as const;
        el.addEventListener("keydown", onKeyDown);
        for (const type of touchTypes) el.addEventListener(type, onTouch);
        return () => {
          el.removeEventListener("keydown", onKeyDown);
          for (const type of touchTypes) el.removeEventListener(type, onTouch);
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
        void state.panTo(); // as on load
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

/** A two-finger tap's longest, second finger down to last up, and how far either may stray — as `isPointDiffDrag` */
/** The aim `aimAtPointer` gives the player: ours alone to clear */
const pointerAim = { at: { x: 0, y: 0 }, rate: 1, untilRest: false };
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmpNdc = new THREE.Vector2();
const tmpHit = new THREE.Vector3();
const twoTapMs = 300;
const twoTapSlopPx = 20;

export type State = {
  /** Key of the npc we consider the player — spawned on arrival if absent */
  key: string;

  /** Place the player if absent, then track them. `false` if they are not where the save left them */
  ensure(): Promise<boolean>;
  /** Whilst `r` is held they face where the pointer meets the floor, eased round by `face.aim` */
  aimAtPointer(): void;
  /** Two fingers down on the canvas that may yet be a tap: since when, and where */
  twoTap: null | { startMs: number; downs: [Touch, Touch] };

  /** The player's controls: `q` psi, `e` their phaser, `f` run — the view's own keys are WorldView's */
  onKeyDown(e: KeyboardEvent): void;
  /** A two-finger tap on the canvas: its left half psi, its right half their phaser — as their hands, and the bar */
  onTouch(e: TouchEvent): void;
  /** Arms them, unlocks them if locked on, else disarms them — arming needs a phaser */
  toggleArm(): void;
  /** Run or walk — their `anim.hurry` */
  toggleRun(): void;
  /** Psi off, else back on to the last target — on needs psi */
  togglePsi(): void;
  /** Pans the camera onto the player, or snaps when `animate` is false */
  panTo(opts?: { animate?: boolean }): Promise<void>;
  /** Saves every npc for `w.mapKey` — see `w.e.persistNpcs` */
  persist(): void;
  /** Target `npcKey` — the player themself for their rings alone, `null` for off. See `Psi` */
  psi(npcKey: null | string): void;
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
