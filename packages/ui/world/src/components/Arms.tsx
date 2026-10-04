import { useStateRef } from "@npc-cli/util";
import { deltaAngle } from "maath/misc";
import { useContext, useEffect } from "react";
import * as THREE from "three/webgpu";
import { advanceBeam, type Beam, type BeamTarget, beamEnd, createBeam } from "../service/arms-beam";
import {
  type ArmsResources,
  armsNodes,
  armsParts,
  createArmsResources,
  MAX_ARMS,
  shaderConfig,
} from "../service/arms-shader";
import { eased } from "../service/fade";
import type { AnimationClipKey } from "./NPCs";
import type { Npc } from "./npc";
import type { UpperAim } from "./npc-animation";
import { WorldContext } from "./world-context";

/**
 * Npcs' stun guns: whilst armed they stand and aim (`stun_aim`, over the upper body on the move), drawn in to
 * `stun_aim_avoid` whenever the arm would touch a crowd neighbour, a wall or a closed door. The gun shows in their
 * right hand, and a beam runs from it to the middle of a body part of their target whilst nothing is between
 * them. Theirs, not a process's: see `w.arms`, jsh `arm` and `disarm`, and `service/arms-beam` for the fades
 */
export default function Arms() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ...createArmsResources(),
      arms: new Map(),
      tickedMs: performance.now(),

      arm(npcKey, opts = {}) {
        const arm = state.ensure(npcKey);
        const at = opts.at ?? null;
        arm.target = at === null || at === npcKey ? null : { npcKey: at, part: opts.part ?? null };
        arm.cast = null; // look again, at once
        const drawn = arm.armed === false;
        arm.armed = true;
        state.sync();
        drawn && w.events.next({ key: "arms", armed: true, npcKeys: [npcKey] });
      },
      disarm(...npcKeys) {
        for (const npcKey of npcKeys) {
          const arm = state.arms.get(npcKey);
          if (arm !== undefined) arm.armed = false;
        }
        state.sync();
      },
      ensure(npcKey) {
        let arm = state.arms.get(npcKey);
        if (arm === undefined) {
          arm = {
            key: npcKey,
            armed: false,
            target: null,
            holdUntil: 0,
            ownAim: null,
            armAim: null,
            muzzleRight: 0,
            ownIdle: null,
            idleBefore: null,
            beam: createBeam(),
            cast: null,
            casting: false,
            castSecs: -Infinity,
            armHit: false,
            inSight: false,
          };
          state.arms.set(npcKey, arm);
        }
        return arm;
      },
      isArmed(npcKey) {
        return state.arms.get(npcKey)?.armed === true;
      },
      markDirty() {
        for (const arm of state.arms.values()) arm.cast = null;
      },
      syncTheme() {
        const theme = w.getTheme();
        // light cannot be added to a pale deck, so there the beam is laid over it, in a deeper ink
        const pale = theme.floor.deck === "light";
        state.color.value.set(shaderConfig.color);
        if (pale) {
          const { h } = state.color.value.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
          state.color.value.setHSL(h, 1, shaderConfig.paleLightness, THREE.SRGBColorSpace);
        }
        state.gunColor.value.set(pale ? shaderConfig.paleGunColor : shaderConfig.gunColor);
        state.gain.value = pale ? 1 : theme.npcs.fxStrength;
        state.faint.value = pale ? shaderConfig.paleFaint : shaderConfig.faint;
        const blending = pale ? THREE.NormalBlending : THREE.AdditiveBlending;
        for (const mat of state.mats.slice(1)) {
          if (mat.blending === blending) continue;
          mat.blending = blending;
          mat.needsUpdate = true;
        }
        w.r3f?.invalidate();
      },
      toggle(npcKey) {
        if (state.isArmed(npcKey)) state.disarm(npcKey);
        else state.arm(npcKey);
        return state.isArmed(npcKey);
      },
      onTick(instant = false) {
        const now = performance.now();
        const step = Math.min((now - state.tickedMs) / 1000, 0.1) / armsConfig.fadeSecs;
        state.tickedMs = now;
        state.phase.value = w.timer.getElapsedTime();

        let count = 0;
        for (const [srcKey, arm] of state.arms) {
          const npc = w.n[srcKey];
          if (npc === undefined) {
            state.arms.delete(srcKey);
            continue;
          }
          state.wield(npc, arm);
          const { beam } = arm;
          advanceBeam(beam, step, (npcKey) => npcKey in w.n, instant);
          const hidden = beam.shown.presence === 0 && beam.gun.presence === 0;
          if (arm.armed === false && hidden) {
            state.arms.delete(srcKey); // disarmed, its pose, stance and aim already let go of
            continue;
          }
          if (hidden || count === MAX_ARMS) continue;

          const hand = npc.group?.getObjectByName("rightforearm");
          if (hand === undefined) continue;
          hand.updateWorldMatrix(true, false); // else a frame stale: the frameloop is on demand
          const tip = hand.localToWorld(tmpTip.fromArray(armsConfig.beamFrom));
          const ry = npc.rotation.y;
          arm.muzzleRight = (tip.x - npc.position.x) * Math.cos(ry) - (tip.z - npc.position.z) * Math.sin(ry);
          const along = tmpAlong.set(0, -1, 0).transformDirection(hand.matrixWorld); // the forearm, towards the hand
          const dst = beam.to === null ? undefined : w.n[beam.to.npcKey];
          const end = beamEnd(beam, tip, along, dst);
          state.srcData.set([tip.x, tip.y, tip.z, eased(beam.shown.presence)], count * 4);
          state.dstData.set([end.x, end.y, end.z, eased(beam.locked.presence)], count * 4);
          const to = dst ?? npc;
          state.roomData.set([npc.roomSlot.value, to.roomSlot.value, npc.npcLit.value, to.npcLit.value], count * 4);
          hand.matrixWorld.decompose(tmpAt, tmpQuat, tmpScale);
          state.gunData.set([tmpAt.x, tmpAt.y, tmpAt.z, tmpScale.x * eased(beam.gun.presence)], count * 4);
          state.quatData.set([tmpQuat.x, tmpQuat.y, tmpQuat.z, tmpQuat.w], count * 4);
          count++;
        }

        state.mesh.visible = count > 0; // else no draw call
        if (count === 0) return; // nor any upload
        state.mesh.geometry.instanceCount = count;
        for (const attr of state.attrs) attr.needsUpdate = true;
      },
      sync() {
        state.onTick(w.disabled === true); // paused: nothing fades, so a change is at once
        w.r3f?.invalidate();
      },
      wield(npc, arm) {
        const secs = w.timer.getElapsedTime();
        const { armed } = arm;
        const target = armed === true && arm.target !== null ? w.n[arm.target.npcKey] : undefined;
        state.recast(npc, arm, target, secs);
        if (armed === true && (arm.armHit === true || npcAhead(w, npc))) {
          arm.holdUntil = secs + armsConfig.holdSecs;
        }
        const avoid = armed === true && arm.holdUntil > secs;

        // the pose — only ours, never another's e.g. psi's hands
        const pose = armed === false ? null : avoid ? armsConfig.avoid : armsConfig.pose;
        const { anim } = npc;
        const shown = anim.upper.target === 1 ? anim.upper.key : null;
        if (pose === null) {
          if (isArmsPose(shown)) anim.setUpper(null);
        } else if (pose !== shown && (shown === null || isArmsPose(shown))) {
          anim.setUpper(pose, { swapSecs: avoid ? armsConfig.drawInSecs : undefined }); // in before the hand goes through
        }

        // the stance — theirs to stand in, and only ours to put back
        const stance = armed === true ? armsConfig.pose : null;
        if (stance !== arm.ownIdle) {
          const from = anim.idleClip.name as AnimationClipKey;
          if (arm.ownIdle === null) arm.idleBefore = from;
          const to = stance ?? arm.idleBefore ?? from;
          if (arm.ownIdle === null || arm.ownIdle === from) {
            anim.idleClip = npc.clips[to]; // else another's since, e.g. they sat
            if (anim.moving === false && anim.pose === from) anim.setPose(to);
          }
          arm.ownIdle = stance;
        }

        // the aim — only ours, so a look still turns them: at the target, else held so a move strafes
        const { face } = anim;
        if (face.aim === null || face.aim === arm.ownAim) {
          /** On a move told not to strafe, whose forward gait a held aim would slide */
          const forwardOnly = npc.isMoving() && anim.strafe !== true && anim.strafeFollowsAim !== true;
          face.aim = arm.ownAim =
            target !== undefined
              ? { at: bearingPast(npc, target, arm.muzzleRight), rate: 1, untilRest: false }
              : armed === true && forwardOnly === false
                ? heldAim
                : null;
        }

        // the gun in hand, and the beam: locked on whilst aiming and in sight
        const { beam } = arm;
        arm.armAim ??= { at: beam.at, from: muzzle, weight: 0 };
        arm.armAim.weight = eased(beam.shown.presence); // the arm follows the beam
        if (anim.upper.aim === null || anim.upper.aim === arm.armAim) anim.upper.aim = armed ? arm.armAim : null;
        beam.gun.target = armed === true ? 1 : 0;
        const locking = target !== undefined && arm.inSight === true;
        beam.shown.target = locking && avoid === false ? 1 : 0;
        if (avoid === false) beam.next = locking ? arm.target : null;
      },
      recast(npc, arm, target, secs) {
        const { reach } = armsConfig;
        if (arm.armed === false || arm.casting === true || secs - arm.castSecs < armsConfig.sampleSecs) return;
        const { x, z } = npc.position;
        const ry = npc.rotation.y;
        const [tx, tz] = target === undefined ? [0, 0] : [target.position.x, target.position.z];
        const { cast } = arm;
        const moved = (ax: number, az: number, bx: number, bz: number) =>
          Math.hypot(ax - bx, az - bz) > armsConfig.recastMoved;
        if (
          cast !== null &&
          cast.target === (target?.key ?? null) &&
          moved(cast.x, cast.z, x, z) === false &&
          Math.abs(deltaAngle(cast.ry, ry)) <= armsConfig.recastTurned &&
          moved(cast.tx, cast.tz, tx, tz) === false
        ) {
          return; // nothing has changed: neither they, their target, nor a door
        }

        arm.cast = { x, z, ry, tx, tz, target: target?.key ?? null };
        arm.castSecs = secs;
        arm.casting = true;
        const hand = { x: x - Math.sin(ry) * reach, y: z - Math.cos(ry) * reach };
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
          .then(([armHit, inSight]) => Object.assign(arm, { armHit, inSight }))
          .finally(() => {
            arm.casting = false;
            w.r3f?.invalidate();
          });
      },
    }),
    // the attributes wrap the data
    {
      reset: {
        mesh: true,
        mats: true,
        attrs: true,
        srcData: true,
        dstData: true,
        roomData: true,
        gunData: true,
        quatData: true,
      },
    },
  );

  w.arms = state;

  useEffect(() => state.syncTheme(), []);

  useEffect(() => {
    // a door opening or closing may clear an arm or a line of sight
    const sub = w.events.subscribe({
      next: (e) => void ((e.key === "door-open" || e.key === "door-closed") && state.markDirty()),
    });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    armsParts.forEach((part, i) => {
      Object.assign(state.mats[i], armsNodes(state, w.view, part), { needsUpdate: true });
    });
    state.onTick(); // a fresh geometry has no instances yet
  }, [w.view.fadeRoomsFx.uid]);

  return <primitive object={state.mesh} />;
}

export type State = ArmsResources & {
  /** By npcKey: whoever is armed, or whose gun or beam still fades */
  arms: Map<string, ArmEntry>;
  tickedMs: number;

  /** Arm them, locked on `at` an npc's `part` — no `at` unlocks */
  arm(npcKey: string, opts?: { at?: null | string; part?: null | string }): void;
  /** Their pose, stance and aim are let go of, and the gun and beam fade */
  disarm(...npcKeys: string[]): void;
  /** Their entry, made if absent */
  ensure(npcKey: string): ArmEntry;
  isArmed(npcKey: string): boolean;
  /** Look again at every arm and line of sight, e.g. a door changed */
  markDirty(): void;
  /** The gun's colour and the beam's gain, ink and blending from the theme — called by `onChangeTheme` */
  syncTheme(): void;
  /** Armed, unlocked, else disarmed: returns whether they now are */
  toggle(npcKey: string): boolean;
  /** `instant` lands every fade at once */
  onTick(instant?: boolean): void;
  sync(): void;
  /** Their pose, stance, aim, gun and beam from their entry */
  wield(npc: Npc, arm: ArmEntry): void;
  /** Raycast `reach` ahead and to the target — but only once something has changed, and one at a time */
  recast(npc: Npc, arm: ArmEntry, target: undefined | Npc, secs: number): void;
};

type ArmEntry = {
  /** npcKey */
  key: string;
  armed: boolean;
  /** Whom they lock on to whilst armed and in sight */
  target: null | BeamTarget;
  /** World seconds they stay drawn in until */
  holdUntil: number;
  /** The aim we set, so we replace or clear only ours */
  ownAim: Npc["anim"]["face"]["aim"];
  /** Metres their muzzle sits to one side of them, as last drawn — their facing allows for it */
  muzzleRight: number;
  /** The arm's aim we set, down the beam */
  armAim: null | UpperAim;
  /** The stance we stand them in, and what they stood in before */
  ownIdle: null | AnimationClipKey;
  idleBefore: null | AnimationClipKey;
  beam: Beam;
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

/** The facing that lines `target` up, not on `npc`, but on a line `right` metres to their side */
function bearingPast(npc: Npc, target: Npc, right: number) {
  const [dx, dz] = [target.position.x - npc.position.x, target.position.z - npc.position.z];
  const turn = Math.asin(THREE.MathUtils.clamp(right / Math.hypot(dx, dz), -0.5, 0.5));
  return npc.anim.bearingOf(target.point) + turn;
}

const armsConfig = {
  /** The pose they stand in and aim with, and the one drawn in to whenever the arm would touch someone or something */
  pose: "stun_aim",
  avoid: "stun_aim_avoid",
  /** Metres ahead a wall or closed door blocks — just past the gun at arm's length, so it is drawn in in time */
  reach: 0.75,
  /** The gun's muzzle, where the beam leaves, off the right forearm — its `+x` is up whilst aiming — in model units */
  beamFrom: [0.12, -0.54, 0] as [number, number, number],
  fadeSecs: 0.3,
  /** Seconds they stay drawn in at least — longer whilst something stays in reach */
  holdSecs: 0.5,
  drawInSecs: 0.15,
  /** Seconds between raycasts at most, and only once they, their target or a door has changed */
  sampleSecs: 0.1,
  /** Metres moved, or radians turned, that call for another raycast */
  recastMoved: 0.05,
  recastTurned: 0.05,
} as const;

/** Ours to clear: never another's upper pose e.g. psi's hands */
const isArmsPose = (key: null | string) => key === armsConfig.pose || key === armsConfig.avoid;

/** Turns them not at all, at `rate` `0`, but is an aim: a move strafes */
const heldAim = { at: 0, rate: 0, untilRest: false };
const muzzle = new THREE.Vector3(...armsConfig.beamFrom);
const tmpTip = new THREE.Vector3();
const tmpAlong = new THREE.Vector3();
const tmpAt = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
