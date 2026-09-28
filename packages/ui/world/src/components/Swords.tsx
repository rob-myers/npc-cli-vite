import { useStateRef } from "@npc-cli/util";
import { deltaAngle } from "maath/misc";
import { useContext, useEffect } from "react";
import * as THREE from "three/webgpu";
import { swordConfig } from "../const.npc";
import { eased } from "../service/fade";
import { advanceRope, createRope, type Rope, type RopeTarget, ropeEnd } from "../service/sword-rope";
import { createSwordResources, MAX_SWORDS, type SwordResources, swordNodes } from "../service/sword-shader";
import type { Npc } from "./npc";
import { WorldContext } from "./world-context";

/**
 * Npcs' swords: whilst drawn they point (upper body), drawing in to `defensive` whenever the arm would touch a
 * crowd neighbour, a wall or a closed door, and a rope runs from the wrist — a faint stub, else straight to the
 * middle of a body part of their target whilst nothing is between them. Theirs, not a process's: see `w.swords`
 * and jsh `sword`, and `service/sword-rope` for the rope's fades
 */
export default function Swords() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ...createSwordResources(),
      swords: new Map(),
      tickedMs: performance.now(),

      draw(...npcKeys) {
        for (const npcKey of npcKeys) state.ensure(npcKey).drawn = true;
        state.sync();
      },
      ensure(npcKey) {
        let sword = state.swords.get(npcKey);
        if (sword === undefined) {
          sword = {
            drawn: false,
            target: null,
            holdUntil: 0,
            ownAim: null,
            rope: createRope(),
            cast: null,
            casting: false,
            castSecs: -Infinity,
            armHit: false,
            inSight: false,
          };
          state.swords.set(npcKey, sword);
        }
        return sword;
      },
      isDrawn(npcKey) {
        return state.swords.get(npcKey)?.drawn === true;
      },
      lock(srcKey, dstKey, part) {
        const sword = state.ensure(srcKey);
        sword.target = dstKey === null || dstKey === srcKey ? null : { npcKey: dstKey, part: part ?? null };
        sword.cast = null; // look again, at once
        state.sync();
      },
      markDirty() {
        for (const sword of state.swords.values()) sword.cast = null;
      },
      sheathe(...npcKeys) {
        for (const npcKey of npcKeys) {
          const sword = state.swords.get(npcKey);
          if (sword !== undefined) sword.drawn = false;
        }
        state.sync();
      },
      toggle(npcKey) {
        const sword = state.ensure(npcKey);
        sword.drawn = !sword.drawn;
        state.sync();
        return sword.drawn;
      },
      onTick(instant = false) {
        if (w.n === null) return; // <NPCs> mounts after us
        const now = performance.now();
        const step = Math.min((now - state.tickedMs) / 1000, 0.1) / swordConfig.fadeSecs;
        state.tickedMs = now;
        state.phase.value = w.timer.getElapsedTime();

        let count = 0;
        for (const [srcKey, sword] of state.swords) {
          const npc = w.n[srcKey];
          if (npc === undefined) {
            state.swords.delete(srcKey);
            continue;
          }
          state.wield(npc, sword);
          const { rope } = sword;
          advanceRope(rope, step, (npcKey) => npcKey in w.n, instant);
          if (sword.drawn === false && sword.target === null && rope.shown.presence === 0) {
            state.swords.delete(srcKey); // sheathed, its pose and aim already let go of
            continue;
          }
          if (rope.shown.presence === 0 || count === MAX_SWORDS) continue;

          const hand = npc.group?.getObjectByName("rightforearm");
          if (hand === undefined) continue;
          hand.updateWorldMatrix(true, false); // else a frame stale: the frameloop is on demand
          const tip = hand.localToWorld(tmpTip.fromArray(swordConfig.ropeFrom));
          const end = ropeEnd(rope, tip, npc.rotation.y, rope.to === null ? undefined : w.n[rope.to.npcKey]);
          state.srcData.set([tip.x, tip.y, tip.z, eased(rope.shown.presence)], count * 4);
          state.dstData.set([end.x, end.y, end.z, eased(rope.locked.presence)], count * 4);
          count++;
        }

        state.mesh.visible = count > 0; // else no draw call
        if (count === 0) return; // nor any upload
        state.geo.instanceCount = count;
        state.geo.getAttribute("swordSrc").needsUpdate = true;
        state.geo.getAttribute("swordDst").needsUpdate = true;
      },
      sync() {
        state.onTick(w.disabled === true); // paused: nothing fades, so a change is at once
        w.r3f?.invalidate();
      },
      wield(npc, sword) {
        const secs = w.timer.getElapsedTime();
        const target = sword.drawn === true && sword.target !== null ? w.n[sword.target.npcKey] : undefined;
        state.recast(npc, sword, target, secs);
        if (sword.drawn === true && (sword.armHit === true || npcAhead(w, npc))) {
          sword.holdUntil = secs + swordConfig.holdSecs;
        }
        const defensive = sword.drawn === true && sword.holdUntil > secs;

        // the pose — only ours, never another's e.g. psi's hands
        const pose = sword.drawn === false ? null : defensive ? "defensive" : "point";
        const { upper } = npc.anim;
        const shown = upper.target === 1 ? upper.key : null;
        if (pose === null) {
          if (isSwordPose(shown)) npc.anim.setUpper(null);
        } else if (pose !== shown && (shown === null || isSwordPose(shown))) {
          npc.anim.setUpper(pose, { swapSecs: defensive ? swordConfig.drawInSecs : undefined }); // in before the hand goes through
        }

        // the aim — only ours, so a look still turns them: at the target, else held so a move strafes
        const { face } = npc.anim;
        if (face.aim === null || face.aim === sword.ownAim) {
          /** On a move told not to strafe, whose forward gait a held aim would slide */
          const forwardOnly = npc.isMoving() && npc.anim.strafe !== true && npc.anim.strafeFollowsAim !== true;
          face.aim = sword.ownAim =
            target !== undefined
              ? { at: target.point, rate: 1, untilRest: false }
              : sword.drawn === true && forwardOnly === false
                ? heldAim
                : null;
        }

        // the rope: pointing, locked on whilst in sight
        sword.rope.shown.target = sword.drawn === true && defensive === false ? 1 : 0;
        if (defensive === false) sword.rope.next = target !== undefined && sword.inSight === true ? sword.target : null;
      },
      recast(npc, sword, target, secs) {
        if (sword.drawn === false || sword.casting === true || secs - sword.castSecs < swordConfig.sampleSecs) return;
        const { x, z } = npc.position;
        const ry = npc.rotation.y;
        const [tx, tz] = target === undefined ? [0, 0] : [target.position.x, target.position.z];
        const { cast } = sword;
        const moved = (ax: number, az: number, bx: number, bz: number) =>
          Math.hypot(ax - bx, az - bz) > swordConfig.recastMoved;
        if (
          cast !== null &&
          cast.target === (target?.key ?? null) &&
          moved(cast.x, cast.z, x, z) === false &&
          Math.abs(deltaAngle(cast.ry, ry)) <= swordConfig.recastTurned &&
          moved(cast.tx, cast.tz, tx, tz) === false
        ) {
          return; // nothing has changed: neither they, their target, nor a door
        }

        sword.cast = { x, z, ry, tx, tz, target: target?.key ?? null };
        sword.castSecs = secs;
        sword.casting = true;
        const hand = { x: x - Math.sin(ry) * swordConfig.reach, y: z - Math.cos(ry) * swordConfig.reach };
        // off the map throws: read as blocked
        void Promise.all([
          w.e.raycast(npc.point, hand).then(
            ({ hit }) => hit !== null,
            () => true,
          ),
          target === undefined
            ? false
            : w.e.raycast(npc.point, target.point).then(
                ({ hit }) => hit === null,
                () => false,
              ),
        ])
          .then(([armHit, inSight]) => Object.assign(sword, { armHit, inSight }))
          .finally(() => {
            sword.casting = false;
            w.r3f?.invalidate();
          });
      },
    }),
    { reset: { geo: true, mat: true, mesh: true, srcData: true, dstData: true } }, // the geometry's attributes wrap the data
  );

  w.swords = state;

  useEffect(() => {
    // a door opening or closing may clear an arm or a line of sight
    const sub = w.events.subscribe({
      next: (e) => void ((e.key === "door-open" || e.key === "door-closed") && state.markDirty()),
    });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    const { vertexNode, colorNode } = swordNodes(state, w.view);
    state.mat.vertexNode = vertexNode;
    state.mat.colorNode = colorNode;
    state.mat.needsUpdate = true;
    state.onTick(); // a fresh geometry has no instances yet
  }, []);

  return <primitive object={state.mesh} />;
}

export type State = SwordResources & {
  /** Per npc with a sword drawn, fading, or locked on to someone */
  swords: Map<string, SwordEntry>;
  tickedMs: number;

  /** Draw their swords */
  draw(...npcKeys: string[]): void;
  /** Their entry, made if absent */
  ensure(npcKey: string): SwordEntry;
  isDrawn(npcKey: string): boolean;
  /** Lock them on to `dstKey`'s `part` whilst drawn and in sight — `null`, or themself, unlocks */
  lock(srcKey: string, dstKey: null | string, part?: null | string): void;
  /** Look again at every arm and line of sight, e.g. a door changed */
  markDirty(): void;
  /** Sheathe their swords: the pose and aim are let go of, and the rope fades */
  sheathe(...npcKeys: string[]): void;
  toggle(npcKey: string): boolean;
  /** `instant` lands every fade at once */
  onTick(instant?: boolean): void;
  sync(): void;
  /** Their pose, aim and rope from their sword's state */
  wield(npc: Npc, sword: SwordEntry): void;
  /** Raycast ahead and to the target — but only once something has changed, and one at a time */
  recast(npc: Npc, sword: SwordEntry, target: undefined | Npc, secs: number): void;
};

type SwordEntry = {
  drawn: boolean;
  /** Whom they lock on to whilst drawn and in sight */
  target: null | RopeTarget;
  /** World seconds they stay defensive until */
  holdUntil: number;
  /** The aim we set, so we replace or clear only ours */
  ownAim: Npc["anim"]["face"]["aim"];
  rope: Rope;
  /** Where they stood, faced, and their target stood, when last cast — `null` is to cast again */
  cast: null | { x: number; z: number; ry: number; tx: number; tz: number; target: null | string };
  casting: boolean;
  /** World seconds of the last cast */
  castSecs: number;
  /** A wall or closed door within reach ahead */
  armHit: boolean;
  /** Nothing between them and their target */
  inSight: boolean;
};

/** Is a crowd neighbour in front of `npc`, within 45° of their facing? */
function npcAhead(w: import("./World").State, npc: Npc) {
  const [fx, fz] = [-Math.sin(npc.rotation.y), -Math.cos(npc.rotation.y)];
  const { x, z } = npc.position;
  return (npc.agent?.neis ?? []).some(({ agentId }) => {
    const { x: ox, z: oz } = w.npc.byAgentId[agentId]?.position ?? { x, z };
    return (ox - x) * fx + (oz - z) * fz > Math.abs((ox - x) * fz - (oz - z) * fx);
  });
}

/** Ours to clear: never another's upper pose e.g. psi's hands */
const isSwordPose = (key: null | string) => key === "point" || key === "defensive";

/** Turns them not at all, at `rate` `0`, but is an aim: a move strafes */
const heldAim = { at: 0, rate: 0, untilRest: false };
const tmpTip = new THREE.Vector3();
