import { useStateRef } from "@npc-cli/util";
import { deltaAngle } from "maath/misc";
import { useContext, useEffect } from "react";
import * as THREE from "three/webgpu";
import { eased } from "../service/fade";
import { advanceBeam, type Beam, type BeamTarget, beamEnd, createBeam } from "../service/phaser-beam";
import {
  createPhaserResources,
  MAX_PHASERS,
  type PhaserResources,
  phaserNodes,
  phaserParts,
  shaderConfig,
} from "../service/phaser-shader";
import type { AnimationClipKey } from "./NPCs";
import type { Npc } from "./npc";
import type { UpperAim } from "./npc-animation";
import { WorldContext } from "./world-context";

/**
 * Npcs' phasers: whilst armed they stand and aim (`phaser_aim`, over the right arm on the move), drawn in to
 * `phaser_aim_avoid` whenever the arm would touch a crowd neighbour, a wall or a closed door. The gun is in their
 * right hand whenever they carry one and stand, and a beam runs from it to the middle of a body part of their target whilst nothing is between
 * them. Theirs, not a process's: see `w.phasers`, jsh `arm` and `disarm`, and `service/phaser-beam` for the fades
 */
export default function Phasers() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ...createPhaserResources(),
      arms: new Map(),
      tickedMs: performance.now(),

      arm(npcKey, opts = {}) {
        if (w.npc.npcToDoable[npcKey] != null) return; // not whilst sat or lain
        const arm = state.ensure(npcKey);
        const at = opts.at ?? null;
        arm.target = at === null || at === npcKey ? null : { npcKey: at, part: opts.part ?? null };
        arm.cast = null; // look again, at once
        const drawn = arm.armed === false;
        arm.armed = true;
        state.sync();
        drawn && w.events.next({ key: "phasers", armed: true, npcKeys: [npcKey] });
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
      holds(npcKey) {
        return w.e.hasItem(npcKey, "phaser") === true && w.npc.npcToDoable[npcKey] == null;
      },
      isArmed(npcKey) {
        return state.arms.get(npcKey)?.armed === true;
      },
      isLocked(npcKey) {
        const arm = state.arms.get(npcKey);
        return arm?.armed === true && arm.target !== null;
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
        else {
          // back onto whom they were locked on when lowered, if still in hand since
          const { npcKey: at, part } = state.arms.get(npcKey)?.target ?? {};
          state.arm(npcKey, { at, part });
        }
        return state.isArmed(npcKey);
      },
      onTick(instant = false) {
        const now = performance.now();
        const step = Math.min((now - state.tickedMs) / 1000, 0.1) / phaserConfig.fadeSecs;
        state.tickedMs = now;
        state.phase.value = w.timer.getElapsedTime();

        // whoever carries one has it in hand, raised or not
        for (const npcKey in w.e.carried) {
          const npc = w.n[npcKey];
          if (state.arms.has(npcKey) || npc === undefined || state.holds(npcKey) === false || leaving(npc)) continue;
          state.ensure(npcKey).beam.gun.presence = 1; // there at once: taken up, stood up, or arrived
        }

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
            state.arms.delete(srcKey); // no longer held, its pose, stance and aim already let go of
            continue;
          }
          if (hidden || count === MAX_PHASERS) continue;

          const hand = npc.group?.getObjectByName("rightforearm");
          if (hand === undefined) continue;
          hand.updateWorldMatrix(true, false); // else a frame stale: the frameloop is on demand
          const tip = hand.localToWorld(tmpTip.fromArray(phaserConfig.beamFrom));
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
          // the forearm is rolled a quarter turn in our pose alone: undone by however much it is NOT, so the
          // gun never turns about its barrel as the arm comes up or down — drawn in, by the blend instead
          const { upper } = npc.anim;
          const { restRoll } = phaserConfig;
          const twist = 2 * Math.atan2(hand.quaternion.y, hand.quaternion.w);
          const roll =
            upper.key === phaserConfig.avoid
              ? (1 - eased(upper.blend)) * restRoll
              : THREE.MathUtils.clamp(restRoll - Math.abs(deltaAngle(0, twist)), 0, restRoll);
          if (roll > 0) tmpQuat.multiply(tmpRoll.set(0, Math.sin(roll / 2), 0, Math.cos(roll / 2))); // about the forearm, its `y`
          const present = eased(beam.gun.presence);
          // scaled about the forearm's origin, their elbow: slid down it, so it shrinks into the hand instead
          tmpAt.addScaledVector(along, phaserConfig.grip * tmpScale.x * (1 - present));
          state.gunData.set([tmpAt.x, tmpAt.y, tmpAt.z, tmpScale.x * present], count * 4);
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
        w.hud?.update();
      },
      wield(npc, arm) {
        const secs = w.timer.getElapsedTime();
        const { armed } = arm;
        const target = armed === true && arm.target !== null ? w.n[arm.target.npcKey] : undefined;
        state.recast(npc, arm, target, secs);
        if (armed === true && (arm.armHit === true || npcAhead(w, npc))) {
          arm.holdUntil = secs + phaserConfig.holdSecs;
        }
        const avoid = armed === true && arm.holdUntil > secs;

        // the pose, over their right arm — only ours, never another's e.g. a reach
        const pose = armed === false ? null : avoid ? phaserConfig.avoid : phaserConfig.pose;
        const { anim } = npc;
        const shown = anim.upper.target === 1 ? anim.upper.key : null;
        if (pose === null) {
          if (isPhaserPose(shown)) anim.setUpper(null);
        } else if (pose !== shown && (shown === null || isPhaserPose(shown))) {
          anim.setUpper(pose, { swapSecs: avoid ? phaserConfig.drawInSecs : undefined }); // in before the hand goes through
        }

        // the stance — theirs to stand in, and only ours to put back
        const stance = armed === true ? phaserConfig.pose : null;
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
        // in hand whilst they carry it and stand, raised or lowered — or whilst armed without one, by jsh
        beam.gun.target = armed === true || state.holds(npc.key) ? 1 : 0;
        // gone at once between the two halves of a teleport, and as they sit or lie
        if (leaving(npc) || w.npc.npcToDoable[npc.key] != null) beam.gun.target = beam.gun.presence = 0;
        else if (beam.gun.target === 1 && beam.gun.presence === 0) beam.gun.presence = 1; // e.g. armed throughout
        const locking = target !== undefined && arm.inSight === true;
        /** The arm is all the way up: no beam on its way there, nor any left as it comes down */
        const raised = armed === true && isPhaserPose(anim.upper.key) && anim.upper.blend === 1;
        beam.shown.target = locking && avoid === false && raised ? 1 : 0;
        if (armed === false) beam.shown.presence = beam.locked.presence = 0;
        if (avoid === false) beam.next = locking ? arm.target : null;
      },
      recast(npc, arm, target, secs) {
        const { reach } = phaserConfig;
        if (arm.armed === false || arm.casting === true || secs - arm.castSecs < phaserConfig.sampleSecs) return;
        const { x, z } = npc.position;
        const ry = npc.rotation.y;
        const [tx, tz] = target === undefined ? [0, 0] : [target.position.x, target.position.z];
        const { cast } = arm;
        const moved = (ax: number, az: number, bx: number, bz: number) =>
          Math.hypot(ax - bx, az - bz) > phaserConfig.recastMoved;
        if (
          cast !== null &&
          cast.target === (target?.key ?? null) &&
          moved(cast.x, cast.z, x, z) === false &&
          Math.abs(deltaAngle(cast.ry, ry)) <= phaserConfig.recastTurned &&
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

  w.phasers = state;

  useEffect(() => state.syncTheme(), []);

  useEffect(() => {
    // a door opening or closing may clear an arm or a line of sight
    const sub = w.events.subscribe({
      next: (e) => void ((e.key === "door-open" || e.key === "door-closed") && state.markDirty()),
    });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    phaserParts.forEach((part, i) => {
      Object.assign(state.mats[i], phaserNodes(state, w.view, part), { needsUpdate: true });
    });
    state.onTick(); // a fresh geometry has no instances yet
  }, [w.view.fadeRoomsFx.uid]);

  return <primitive object={state.mesh} />;
}

export type State = PhaserResources & {
  /** By npcKey: whoever is armed, or whose gun or beam still fades */
  arms: Map<string, ArmEntry>;
  tickedMs: number;

  /** Arm them, locked on `at` an npc's `part` — no `at` unlocks */
  arm(npcKey: string, opts?: { at?: null | string; part?: null | string }): void;
  /** Their pose, stance and aim are let go of, and the gun and beam fade */
  disarm(...npcKeys: string[]): void;
  /** Their entry, made if absent */
  ensure(npcKey: string): ArmEntry;
  /** Carries one and stands, so has it in hand — raised or not */
  holds(npcKey: string): boolean;
  isArmed(npcKey: string): boolean;
  /** Armed, and locked on someone */
  isLocked(npcKey: string): boolean;
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

const phaserConfig = {
  /** The pose they stand in and aim with, and the one drawn in to whenever the arm would touch someone or something */
  pose: "phaser_aim",
  avoid: "phaser_aim_avoid",
  /** Metres ahead a wall or closed door blocks — just past the gun at arm's length, so it is drawn in in time */
  reach: 0.75,
  /** The gun's muzzle, where the beam leaves, off the right forearm — its `+x` is up whilst aiming — in model units */
  beamFrom: [0.12, -0.54, 0] as [number, number, number],
  /** How far down the forearm the hand holds it, which it fades into and out of — model units */
  grip: 0.29,
  fadeSecs: 0.3,
  /** Radians about the right forearm between an arm at rest and the pose's — see `onTick` */
  restRoll: Math.PI / 2,
  /** Seconds they stay drawn in at least — longer whilst something stays in reach */
  holdSecs: 0.5,
  drawInSecs: 0.15,
  /** Seconds between raycasts at most, and only once they, their target or a door has changed */
  sampleSecs: 0.1,
  /** Metres moved, or radians turned, that call for another raycast */
  recastMoved: 0.05,
  recastTurned: 0.05,
} as const;

/** Faded right out, mid-teleport: in their hand until then, and again as they fade back in */
const leaving = (npc: Npc) => npc.colorScale.value === 0;

/** Ours to clear: never another's upper pose e.g. psi's hands */
const isPhaserPose = (key: null | string) => key === phaserConfig.pose || key === phaserConfig.avoid;

/** Turns them not at all, at `rate` `0`, but is an aim: a move strafes */
const heldAim = { at: 0, rate: 0, untilRest: false };
const muzzle = new THREE.Vector3(...phaserConfig.beamFrom);
const tmpTip = new THREE.Vector3();
const tmpAlong = new THREE.Vector3();
const tmpAt = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpRoll = new THREE.Quaternion();
