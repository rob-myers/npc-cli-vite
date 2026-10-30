import { cn, useStateRef } from "@npc-cli/util";
import { deltaAngle } from "maath/misc";
import { Fragment, useContext, useEffect } from "react";
import * as THREE from "three/webgpu";
import { hitConfig, psiActions } from "../const.npc";
import { type Aim, aimToRay, alongAim, npcOnRay } from "../service/aim-target";
import { helper } from "../service/helper";
import {
  actionClass,
  cancelClass,
  markClass,
  OverlayBounds,
  offsetUnder,
  pin,
  showMark,
  toScreen,
} from "../service/overlay";
import { bodyPartPoint, type PartHit, type StruckKind } from "../service/phaser-beam";
import type { Npc } from "./npc";
import type { State as WorldState } from "./World";
import { WorldContext } from "./world-context";

/**
 * Who targets whom. A raised phaser targets whoever its ray meets, of those in the rooms its last cast passed
 * through: the player's Space fires. Psi focuses on someone to act on them. See `docs/engagements.md`
 */
export default function NpcFocus() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      boxes: new OverlayBounds(() => w.r3f?.invalidate()),
      phasers: new Map(),
      psis: new Map(),
      lasers: new Set(),
      el: null,
      actionsEl: null,
      cancelEl: null,
      casting: false,
      showing: false,
      act(by, action) {
        const entry = state.psis.get(by);
        if (entry === undefined) return;
        state.unfocus(by);
        w.events.next({ key: "psi-action", by, npcKey: entry.npcKey, action });
        if (by === w.player.key) w.hud?.say(`${action} ${entry.npcKey}`);
      },
      cancel(by) {
        w.phasers.aimAt(by, null);
        const entry = state.phasers.get(by);
        if (entry === undefined) return;
        state.phasers.delete(by);
        state.update();
      },
      fire(by) {
        const entry = state.phasers.get(by);
        if (entry === undefined) return false;
        // one with a laser dot, or a held aim, stays whilst raised: anyone else's is over
        if (state.showsDot(by) === false && w.phasers.arms.get(by)?.aimAt?.held !== true) {
          state.phasers.delete(by);
          state.update();
        }
        const aim = (entry.aim = w.phasers.aimOf(by)); // as it is now
        state.syncTarget(entry);
        const { met } = entry;
        const target = w.n?.[entry.npcKey ?? ""];
        // no one met: along the line, to whatever stops it. Where its dot is, if cast along this aim
        if (target === undefined || aim === null || met == null) {
          const { end } = entry;
          const current = end != null && aim !== null && entry.ending !== true && isCastStale(entry, aim) === false;
          return w.phasers.fireAlong(by, current ? end : undefined);
        }
        // where its dot is, held on the part it meets
        w.phasers.arm(by, { at: target.key, part: met.part, local: met.local.clone() }); // left raised after
        return true;
      },
      focus(by, npcKey, atPointer = false) {
        if (w.n?.[by] === undefined || w.n[npcKey] === undefined || by === npcKey) return;
        state.psis.set(by, { by, npcKey, lit: false, atPointer, offset: null });
        if (by === w.player.key) state.syncLit(); // their room unlit already, e.g. through a window, does not drop it
        state.update();
        w.r3f?.invalidate();
      },
      onFrame() {
        const stale: PhaserEntry[] = [];
        for (const entry of state.phasers.values()) {
          // this frame's aim, once: none unless aiming
          entry.aim = isAiming(w, entry.by) ? w.phasers.aimOf(entry.by) : null;
          if (entry.aim !== null && isCastStale(entry, entry.aim)) stale.push(entry);
          state.syncTarget(entry);
        }
        // one batch at a time, of every aim that has moved
        if (stale.length > 0 && state.casting !== true) state.syncEnds(stale);
        state.place();
      },
      place() {
        const camera = w.r3f?.camera;
        if (camera === undefined || state.el === null) return;
        let showing = state.psis.has(w.player.key) && w.e.isPsiRaised(w.player.key) === true;
        for (const entry of state.phasers.values()) showing ||= entry.aim != null;
        // hidden already, there is nothing to place
        if (showing === false && state.showing === false) return;
        state.showing = showing;
        if (state.boxes.sync(state.el, w.view.canvas) === false) return;
        const { canvas, box } = state.boxes;
        camera.updateMatrixWorld(); // as it is this frame, not the last
        const toScreenAt = (point: THREE.Vector3) => toScreen(point, camera, canvas, box);
        const onScreen = (npc: Npc, bone: string) => toScreenAt(bodyPartPoint(npc, bone, tmpPoint));
        /** Each target's dots, in turn */
        const dotsOn = new Map<Npc, HTMLElement[]>();
        const addDot = (on: Npc, el: HTMLElement) => {
          const els = dotsOn.get(on);
          if (els === undefined) dotsOn.set(on, [el]);
          else els.push(el);
        };

        for (const entry of state.phasers.values()) {
          const aiming = entry.aim != null;
          const on = aiming ? w.n?.[entry.npcKey ?? ""] : undefined;
          showMark(entry.dotEl, on !== undefined);
          // the player's dot: on whom they target, where a shot would land, else where one at no one would
          if (on !== undefined && entry.endEl != null) state.placeOn(entry, toScreenAt);
          else state.placeEnd(entry, toScreenAt, aiming && on === undefined);
          if (on !== undefined && entry.dotEl != null) addDot(on, entry.dotEl); // without a laser dot
        }
        const { dotGapPx, dotAbovePx, actionsOffPx } = npcFocusConfig;
        for (const [on, els] of dotsOn) {
          const head = onScreen(on, "head");
          els.forEach((el, i) =>
            pin(el, { x: head.x + (i - (els.length - 1) / 2) * dotGapPx, y: head.y - dotAbovePx }),
          );
        }

        // the player's psi actions, kept where they opened relative to whom they focus on
        const own = state.psis.get(w.player.key);
        const on = w.n?.[own?.npcKey ?? ""];
        const shown = on !== undefined && w.e.isPsiRaised(w.player.key) === true;
        showMark(state.actionsEl, shown);
        const { actionsEl, cancelEl } = state;
        if (actionsEl === null || cancelEl === null || own === undefined || on === undefined || shown === false) return;
        const chest = onScreen(on, "chest");
        // Cancel under the press that opened it, else beside their chest
        const { down } = w.view.lastPointer;
        own.offset ??= own.atPointer
          ? offsetUnder(down, chest, canvas, box)
          : { x: actionsOffPx + cancelEl.offsetWidth / 2, y: 0 };
        const x = chest.x + own.offset.x - cancelEl.offsetLeft - cancelEl.offsetWidth / 2;
        const y = chest.y + own.offset.y - cancelEl.offsetTop - cancelEl.offsetHeight / 2;
        actionsEl.style.transform = `translate(${x}px,${y}px)`;
      },
      placeOn(entry, toScreenAt) {
        const { endEl, met } = entry;
        showMark(endEl, met != null);
        if (met == null || endEl == null) return;
        endEl.toggleAttribute("data-on", true);
        pin(endEl, toScreenAt(tmpEnd.copy(met.point)));
      },
      placeEnd(entry, toScreenAt, shown) {
        const { aim, end, endEl } = entry;
        showMark(endEl, shown && aim != null && end != null);
        if (aim == null || end == null || endEl == null) return;
        endEl.toggleAttribute("data-on", false);
        // along the aim as it is now, its length from the last cast: else it lags a turn
        pin(endEl, toScreenAt(alongAim(aim, end.dist, tmpEnd)));
      },
      reachOf(by) {
        const entry = state.phasers.get(by);
        const npc = w.n?.[by];
        if (entry?.aim == null || entry.end == null || npc === undefined) return null;
        const at = alongAim(entry.aim, entry.end.dist, tmpEnd);
        return Math.hypot(at.x - npc.position.x, at.z - npc.position.z);
      },
      recast() {
        for (const entry of state.phasers.values()) entry.castAt = null;
        w.r3f?.invalidate();
      },
      removed(npcKeys) {
        let changed = false;
        for (const [by, entry] of state.phasers) {
          if (npcKeys.includes(by)) changed = state.phasers.delete(by);
          else if (npcKeys.includes(entry.npcKey ?? "")) entry.npcKey = null;
        }
        for (const [by, entry] of state.psis) {
          if (npcKeys.includes(by) || npcKeys.includes(entry.npcKey)) changed = state.psis.delete(by);
        }
        for (const npcKey of npcKeys) state.lasers.delete(npcKey);
        if (changed === true) state.update();
      },
      setLaser(npcKey, next = !state.lasers.has(npcKey)) {
        if (npcKey === w.player.key) return; // theirs is always on
        if (next === true) state.lasers.add(npcKey);
        else state.lasers.delete(npcKey);
        if (next === true && w.phasers.isArmed(npcKey) === true) state.target(npcKey);
        else if (next === false) state.cancel(npcKey);
        state.update();
        w.r3f?.invalidate();
        w.events.next({ key: "npc-toggled", npcKey });
      },
      showsDot(npcKey) {
        return npcKey === w.player.key || state.lasers.has(npcKey);
      },
      syncEnds(entries) {
        state.casting = true;
        for (const entry of entries) {
          const { aim } = entry;
          entry.ending = true;
          if (aim != null)
            entry.castAt = { x: aim.from.x, z: aim.from.y, y: aim.y, bearing: aim.bearing, pitch: aim.pitch };
        }
        void w.phasers
          .endsAlong(entries.map((entry) => entry.by))
          .then((ends) => {
            let changed = false;
            for (const [i, entry] of entries.entries()) {
              const [was, end] = [entry.end, ends[i]];
              const roomIds = end?.rooms.map((grKey) => helper.getGmRoomId(grKey)) ?? [];
              entry.end = end === null ? null : { ...end, roomIds, secs: w.realTime.now() };
              changed ||= endsDiffer(was, entry.end);
            }
            // a frame only for a change, so a still aim lets the World rest
            if (changed === true) w.r3f?.invalidate();
          })
          .finally(() => {
            state.casting = false;
            for (const entry of entries) entry.ending = false;
          });
      },
      syncLit(grKey) {
        const entry = state.psis.get(w.player.key);
        if (entry === undefined) return;
        const at = grKey ?? w.npc.npcToRoom.get(entry.npcKey)?.grKey;
        const lit = w.view.fadeRoomsFx.rooms.some((room) => room.grKey === at);
        if (entry.lit === true && lit === false) return state.unfocus(entry.by);
        entry.lit = lit;
      },
      syncTarget(entry) {
        const { aim, end } = entry;
        if (aim == null || end == null) return void (entry.npcKey = null);
        // those in the rooms its last cast passed through: no wall is between. Not one it passes through
        tmpNear.length = 0;
        for (const { gmId, roomId } of end.roomIds ?? []) {
          for (const key of w.npc.roomToNpcs[gmId]?.[roomId] ?? []) {
            const npc = w.n[key];
            if (npc !== undefined && w.npcGhost?.ghosts.has(key) !== true) tmpNear.push(npc);
          }
        }
        entry.met ??= { part: "", local: new THREE.Vector3(), point: new THREE.Vector3(), dist: 0 };
        const met = npcOnRay(aimToRay(aim, tmpRay), tmpNear, entry.by, hitBones, entry.met);
        const { point } = entry.met;
        // short of what stopped the cast, or against it
        const short = Math.hypot(point.x - aim.from.x, point.z - aim.from.y) <= end.dist + npcFocusConfig.againstM;
        entry.npcKey = met !== null && short ? met.key : null;
      },
      target(by) {
        if (w.n?.[by] === undefined || state.phasers.has(by) === true) return;
        if (w.phasers.isArmed(by) === false) w.phasers.arm(by);
        if (w.phasers.isArmed(by) === false) return; // e.g. none carried, or in pain
        const entry: PhaserEntry = {
          by,
          npcKey: null,
          aim: null,
          end: null,
          ending: false,
          castAt: null,
          met: null,
          dotEl: null,
          endEl: null,
        };
        state.phasers.set(by, entry);
        state.update();
        w.r3f?.invalidate();
      },
      unfocus(by) {
        if (state.psis.delete(by) === true) state.update();
      },
    }),
  );

  w.npcFocus = state;

  useEffect(() => {
    const sub = w.events.subscribe({
      next(e) {
        if (e.key === "update-faded-rooms") state.syncLit();
        else if (e.key === "phasers" && e.armed === true) {
          // the player's, and those with a laser, target whilst raised
          for (const npcKey of e.npcKeys) if (state.showsDot(npcKey) === true) state.target(npcKey);
        } else if (e.key === "enter-room" && e.npcKey === state.psis.get(w.player.key)?.npcKey) {
          state.syncLit(e.gmRoomId.grKey);
        } else if (e.key === "removed-npcs") state.removed(e.npcKeys);
        else if (doorChanges.has(e.key)) state.recast(); // a door between may have opened or shut
      },
    });
    if (w.phasers?.isArmed(w.player.key) === true) state.target(w.player.key); // raised already, e.g. over hmr
    return () => {
      sub.unsubscribe();
      state.boxes.dispose();
    };
  }, []);

  const phasers = [...state.phasers.values()];
  const psis = [...state.psis.values()];
  const own = state.psis.get(w.player.key);
  const live = phasers.length + psis.length > 0;

  useEffect(() => {
    if (live === false) return;
    // over them in the World's own frame, after the camera has moved, so they keep up with it
    return w.e.addFrameCallback(() => state.onFrame());
  }, [live]);

  return (
    <div
      ref={(el) => void (state.el = el)}
      className="group/focus pointer-events-none absolute inset-0 z-20 select-none overflow-hidden"
      // its pulse holds whilst the World is paused
      data-paused={w.disabled ? "" : undefined}
      // the World keeps the focus, and with it the keys
      onMouseDown={(e) => e.preventDefault()}
    >
      {phasers.map((entry) => (
        <Fragment key={entry.by}>
          {state.showsDot(entry.by) === false && (
            <span
              ref={(el) => void (entry.dotEl = el)}
              data-off=""
              className={cn(markClass, "size-2.5 rounded-full border border-black/50 bg-red-500")}
            />
          )}
          {state.showsDot(entry.by) === true && (
            // pulsing on whom it targets (`laser-pulse`)
            <span
              ref={(el) => void (entry.endEl = el)}
              data-off=""
              className={cn(markClass, "group flex size-2.5 items-center justify-center")}
            >
              <span
                className={cn(
                  "rounded-full group-data-paused/focus:[animation-play-state:paused]",
                  // on a light floor, deeper and edged darker, its pulse gentler
                  w.themeKey === "light-theme"
                    ? "size-1.5 bg-red-600 shadow-[0_0_0_1px_rgb(127_29_29/0.8),0_0_3px_1px_rgb(220_38_38/0.5)] group-data-on:animate-[laser-pulse-soft_1100ms_ease-in-out_infinite]"
                    : "size-1 bg-red-400 shadow-[0_0_0_1px_rgb(0_0_0/0.7),0_0_3px_1px_rgb(248_113_113)] group-data-on:animate-[laser-pulse_700ms_ease-in-out_infinite]",
                )}
              />
            </span>
          )}
        </Fragment>
      ))}
      {own !== undefined && (
        <div ref={(el) => void (state.actionsEl = el)} data-off="" className={cn(markClass, "flex flex-col gap-1")}>
          {psiActions.map((action) => (
            <button
              key={action}
              type="button"
              tabIndex={-1}
              className={actionClass}
              onPointerDown={(e) => e.stopPropagation()}
              // on click: removed on pointer down, the pointer up would press the World beneath
              onClick={() => state.act(own.by, action)}
            >
              {action}
            </button>
          ))}
          <button
            ref={(el) => void (state.cancelEl = el)}
            type="button"
            tabIndex={-1}
            className={cancelClass}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => state.unfocus(own.by)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/** Its last cast was from elsewhere, or along another aim, or a door has changed since */
function isCastStale(entry: PhaserEntry, aim: Aim) {
  const at = entry.castAt;
  if (at == null) return true; // undefined in an entry from before hmr
  const { castMovedM: m, castTurnedRad: rad } = npcFocusConfig;
  return (
    Math.hypot(aim.from.x - at.x, aim.from.y - at.z) > m ||
    Math.abs(aim.y - at.y) > m ||
    Math.abs(deltaAngle(aim.bearing, at.bearing)) > rad ||
    Math.abs(aim.pitch - at.pitch) > rad
  );
}

/** Two casts' ends differ, enough to draw again */
function endsDiffer(a: PhaserEntry["end"], b: PhaserEntry["end"]) {
  if (a == null || b == null) return a !== b;
  return a.what !== b.what || a.at.distanceTo(b.at) > 0.01 || a.rooms.join() !== b.rooms.join();
}

/** Their phaser is all the way up and not drawn in, e.g. by a wall: its marks show only then */
const isAiming = (w: WorldState, npcKey: string) =>
  w.phasers.isRaised(npcKey) === true && w.phasers.isDrawnIn(npcKey) === false;

const tmpPoint = new THREE.Vector3();
const tmpEnd = new THREE.Vector3();
const tmpRay = new THREE.Ray();
const tmpNear: Npc[] = [];
/** The events after which a cast may end elsewhere */
const doorChanges = new Set<string>(["door-open", "door-closed", "door-opening", "door-closing"]);
/** The bones a shot may meet: those of a hit region */
const hitBones = Object.keys(hitConfig.region);

const npcFocusConfig = {
  /** Metres past what stopped its cast an npc is still crossed: one stood against a wall */
  againstM: 0.3,
  /** Metres the muzzle moves, and radians the aim turns or tilts, before casting again: any move, but a still aim casts no more */
  castMovedM: 0.001,
  castTurnedRad: 0.0001,
  /** Pixels apart the dots over someone are, and how far above their head */
  dotGapPx: 12,
  dotAbovePx: 22,
  /** Pixels right of their chest the player's psi actions are */
  actionsOffPx: 28,
} as const;

/** A phaser targeting whoever its ray meets: the player's whilst raised, anyone else's until fired or cancelled */
export type PhaserEntry = {
  by: string;
  /** Whom its ray meets, as of the last frame */
  npcKey: null | string;
  /** Where its ray meets them, as of the last frame */
  met: null | PartHit;
  /** Its aim this frame, worked out once: `null` unless aiming */
  aim: null | Aim;
  /** Where a shot at no one would land, along its aim, and the rooms it passes through, as of real `secs` */
  /** Cast for whilst `ending` */
  end: null | {
    at: THREE.Vector3;
    what: StruckKind;
    decorKey: null | string;
    dist: number;
    rooms: Geomorph.GmRoomKey[];
    roomIds: Geomorph.GmRoomId[];
    secs: number;
  };
  ending: boolean;
  /** The aim its last cast was along: `null` to cast again */
  castAt: null | { x: number; z: number; y: number; bearing: number; pitch: number };
  /** Its dot over them (not the player's), and the player's dot where a shot would land: pulsing on an npc */
  dotEl: null | HTMLSpanElement;
  endEl: null | HTMLSpanElement;
};

/** Psi focused on someone, to act on them */
export type PsiEntry = {
  by: string;
  npcKey: string;
  /** Their room was lit at the last `syncLit`. The player's alone */
  lit: boolean;
  /** Opened by a press: its Cancel goes under it */
  atPointer: boolean;
  /** Pixels from their chest the player's Cancel is, fixed on its first frame */
  offset: null | Geom.VectJson;
};

export type State = {
  /** The canvas and this overlay, as last measured on a resize */
  boxes: OverlayBounds;
  /** By shooter */
  phasers: Map<string, PhaserEntry>;
  /** By whom psi acts */
  psis: Map<string, PsiEntry>;
  /** Npcs whose phaser shows a laser dot, as the player's does */
  lasers: Set<string>;
  el: null | HTMLDivElement;
  /** The player's psi actions, beside whom they focus on */
  actionsEl: null | HTMLDivElement;
  /** Their Cancel, placed under the press that opened it */
  cancelEl: null | HTMLButtonElement;
  /** A batch of casts is out: one at a time */
  casting: boolean;
  /** Something was shown last frame: else, nothing to show, `place` does nothing */
  showing: boolean;
  /** `by`'s psi acts on whom they focus on, a placeholder: emits `psi-action` */
  act(by: string, action: string): void;
  /** Drops `by`'s phaser target without firing, the phaser left raised */
  cancel(by: string): void;
  /** Fires at whom `by`'s phaser targets, where its ray meets them, else along its line: `false` if it cannot */
  fire(by: string): boolean;
  /** Focuses `by`'s psi on `npcKey`, replacing any other */
  /** `atPointer`: opened by a press, so the player's Cancel goes under it */
  focus(by: string, npcKey: string, atPointer?: boolean): void;
  /** Each frame: each raised phaser's cast, whom its line crosses, then the marks */
  onFrame(): void;
  /** Pins each dot over its target, the player's laser dot, and their psi actions beside whom they focus on */
  place(): void;
  /** Pins `entry`'s dot where its ray meets whom it targets */
  placeOn(entry: PhaserEntry, toScreenAt: (point: THREE.Vector3) => Geom.VectJson): void;
  /** Pins `entry`'s dot where a shot at no one would land, whilst `shown`: no one is crossed */
  placeEnd(entry: PhaserEntry, toScreenAt: (point: THREE.Vector3) => Geom.VectJson, shown: boolean): void;
  /** Metres along the ground from `by` to where a shot at no one would land, `null` unless aiming and cast */
  reachOf(by: string): null | number;
  /** Casts again along every aim, e.g. a door or shield changed */
  recast(): void;
  /** Forgets entries by or on `npcKeys` */
  removed(npcKeys: string[]): void;
  /** Gives `npcKey` a laser, or takes it: their phaser shows a laser dot and targets whilst raised */
  setLaser(npcKey: string, next?: boolean): void;
  /** Their phaser shows a laser dot: the player's, or one with a laser */
  showsDot(npcKey: string): boolean;
  /** Casts along each entry's aim, in one request, for where a shot at no one would land: their `end` */
  syncEnds(entries: PhaserEntry[]): void;
  /** Notes whether room `grKey` is lit, by default that of whom the player's psi focuses on. Going unlit drops it */
  syncLit(grKey?: string): void;
  /** Whom `entry`'s ray meets now: the nearest in the rooms its last cast passed through, short of where it stopped */
  syncTarget(entry: PhaserEntry): void;
  /** `by` targets whoever their phaser's ray meets, raising it if need be. The player's, whenever theirs is raised */
  target(by: string): void;
  /** Drops `by`'s psi focus */
  unfocus(by: string): void;
};
