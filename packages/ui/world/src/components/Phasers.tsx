import { useStateRef } from "@npc-cli/util";
import { warn } from "@npc-cli/util/legacy/generic";
import { deltaAngle } from "maath/misc";
import { useContext, useEffect } from "react";
import * as THREE from "three/webgpu";
import { npcDims } from "../const.both";
import { hitConfig, lieAim } from "../const.npc";
import { eased } from "../service/fade";
import { advanceBeam, type Beam, type BeamTarget, beamEnd, bodyPartPoint, createBeam } from "../service/phaser-beam";
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
 * `phaser_aim_avoid` whenever the arm would touch someone, a wall, a closed door or a live shield. The gun is in their
 * right hand whenever they carry one and stand, and a beam runs from it to the middle of a body part of their target whilst nothing is between
 * them. Theirs, not a process's: see `w.phasers`, jsh `phaser`, `service/phaser-beam` for the fades, and `docs/engagements.md`
 */
export default function Phasers() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ...createPhaserResources(),
      arms: new Map(),
      tickedSecs: w.gameTime.now(),

      aimOff(npcKey, at) {
        const arm = state.arms.get(npcKey);
        const npc = w.n?.[npcKey];
        if (arm?.armed !== true || arm.armAim?.at !== arm.armAt || npc === undefined) return null;
        const pointed = npc.anim.bearingOf({ x: arm.armAt.x, y: arm.armAt.z });
        return Math.abs(deltaAngle(pointed, npc.anim.bearingOf(at)));
      },
      arm(npcKey, opts = {}) {
        if (w.npc.npcToDoable[npcKey] != null && w.n?.[npcKey]?.anim.posture === "stand") return; // sat or lain alone
        if (w.e.hasItem(npcKey, "phaser") === false) return; // nor without one
        if (w.shields?.isDead(npcKey) === true) {
          if (npcKey === w.player.key) w.hud?.say("phaser deactivated");
          return;
        }
        if (w.n?.[npcKey]?.anim.hurt != null) return; // nor in pain, or pacified
        const arm = state.ensure(npcKey);
        const at = opts.at ?? null;
        arm.target = at === null || at === npcKey ? null : { npcKey: at, part: opts.part ?? null };
        arm.toward = opts.toward ?? null;
        arm.cast = null; // look again, at once
        arm.hitAt = null;
        const secs = w.gameTime.now();
        arm.lowerAt = opts.once === true ? secs + phaserConfig.onceSecs : null;
        const drawn = arm.armed === false;
        arm.armed = true;
        state.sync();
        drawn && w.events.next({ key: "phasers", armed: true, npcKeys: [npcKey] });
      },
      disarm(...npcKeys) {
        for (const npcKey of npcKeys) {
          const arm = state.arms.get(npcKey);
          if (arm !== undefined) lower(arm);
        }
        state.sync();
      },
      ensure(npcKey) {
        let arm = state.arms.get(npcKey);
        if (arm === undefined) {
          arm = {
            armAim: null,
            armAt: new THREE.Vector3(),
            armed: false,
            armHit: false,
            beam: createBeam(),
            cast: null,
            casting: false,
            castSecs: -Infinity,
            firedSecs: null,
            gliding: false,
            hand: null,
            hitAt: null,
            holdUntil: 0,
            idleBefore: null,
            key: npcKey,
            lockAim: { at: 0, rate: 1, untilRest: false },
            lowerAt: null,
            muzzleRight: 0,
            npcHit: false,
            npcPolledSecs: -Infinity,
            ownAim: null,
            ownIdle: null,
            ownTurn: false,
            pointAt: null,
            reach: { obstacles: [], wallHit: false },
            shielded: false,
            shot: null,
            sight: { across: [], from: { x: 0, y: 0 }, inSight: false, shields: [] },
            struck: null,
            target: null,
            toward: null,
          };
          state.arms.set(npcKey, arm);
        }
        return arm;
      },
      hold(npcKey) {
        if (state.arms.has(npcKey) || w.n?.[npcKey] === undefined || state.holds(npcKey) === false) return;
        state.ensure(npcKey).beam.gun.presence = 1; // there at once: taken up, stood up, or arrived
        w.r3f?.invalidate();
      },
      holds(npcKey) {
        return w.e.hasItem(npcKey, "phaser") === true && w.npc.npcToDoable[npcKey] == null;
      },
      isAimed(npcKey) {
        const arm = state.arms.get(npcKey);
        return arm?.armed === true && arm.gliding === false && w.n?.[npcKey]?.anim.isRolling() === false;
      },
      isArmed(npcKey) {
        return state.arms.get(npcKey)?.armed === true;
      },
      isClear(npcKey) {
        const arm = state.arms.get(npcKey);
        const npc = w.n?.[npcKey];
        if (arm === undefined || npc === undefined || arm.casting === true) return false;
        const target = arm.target === null ? undefined : w.n[arm.target.npcKey];
        // a hit found by the last cast draws it in only at the next tick
        if (isCastCurrent(arm, npc, target) === false || arm.armHit === true) return false;
        return state.isRaised(npcKey) === true && state.isDrawnIn(npcKey) === false;
      },
      isDrawnIn(npcKey) {
        const arm = state.arms.get(npcKey);
        return arm?.armed === true && arm.holdUntil > w.gameTime.now();
      },
      isRaised(npcKey) {
        const upper = w.n?.[npcKey]?.anim.upper;
        return state.isArmed(npcKey) && upper !== undefined && isPhaserPose(upper.key) && upper.blend === 1;
      },
      isLocked(npcKey) {
        const arm = state.arms.get(npcKey);
        return arm?.armed === true && arm.target !== null;
      },
      lowerAwhile(npcKey) {
        const arm = state.arms.get(npcKey);
        if (arm?.armed !== true) return null;
        const { target, toward, lowerAt } = arm;
        const pointAt = arm.pointAt === null ? null : { ...arm.pointAt };
        state.disarm(npcKey);
        return () => {
          if (state.isArmed(npcKey) === true) return; // raised since
          const opts = { at: target?.npcKey, part: target?.part, toward: toward ?? undefined, once: lowerAt !== null };
          state.arm(npcKey, opts);
          if (pointAt !== null) state.pointAt(npcKey, pointAt);
        };
      },
      markDirty() {
        for (const arm of state.arms.values()) arm.cast = null;
      },
      outcomeOf(npcKey, to) {
        const forced = w.debug?.forceShot ?? null;
        if (forced !== null) return forced;
        try {
          return w.e.shotResolver?.({ by: npcKey, npcKey: to.npcKey, part: to.part }) ?? "hit";
        } catch (e) {
          warn(`shotResolver: ${e}`);
          return "hit";
        }
      },
      pointAt(npcKey, at) {
        const arm = state.arms.get(npcKey);
        if (arm?.armed !== true) return;
        arm.pointAt = Object.assign(arm.pointAt ?? { x: 0, y: 0 }, { x: at.x, y: at.y });
        arm.toward = null;
        w.r3f?.invalidate();
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
        const now = w.gameTime.now();
        const delta = Math.min(now - state.tickedSecs, 0.1);
        const step = delta / phaserConfig.fadeSecs;
        state.tickedSecs = now;
        state.phase.value = now;

        let count = 0;
        for (const [srcKey, arm] of state.arms) {
          const npc = w.n[srcKey];
          if (npc === undefined) {
            state.arms.delete(srcKey);
            continue;
          }
          state.wield(npc, arm, delta);
          const { beam } = arm;
          advanceBeam(beam, step, w.n, instant);
          if (beam.locked.presence === 0) arm.struck = arm.hitAt = arm.shot = null; // no object made, most ticks
          if (beam.to !== null && beam.locked.target === 1 && arm.shot?.to !== beam.to) state.shoot(npc, arm, beam.to);
          if (beam.locked.presence === 1 && beam.to !== arm.struck) state.strike(npc, arm);
          const hidden = beam.shown.presence === 0 && beam.gun.presence === 0;
          if (arm.armed === false && hidden && state.holds(srcKey) === false) {
            state.arms.delete(srcKey); // no longer held, its pose, stance and aim already let go of
            continue;
          }
          if (hidden || count === MAX_PHASERS) continue;
          const dst = beam.to === null ? undefined : w.n[beam.to.npcKey];
          // out of sight at both ends nothing of it is drawn, so nothing is worked out: `wield` above still ran
          if (unseen(w, npc) && (dst === undefined || unseen(w, dst))) continue;

          if (state.draw(npc, arm, dst, count) === true) count++;
        }

        state.mesh.visible = count > 0; // else no draw call
        if (count === 0) return; // nor any upload
        state.mesh.geometry.instanceCount = count;
        for (const attr of state.attrs) attr.needsUpdate = true;
      },
      draw(npc, arm, dst, i) {
        const hand = handOf(npc, arm);
        if (hand === null) return false;
        const { beam } = arm;
        hand.updateWorldMatrix(true, false); // else a frame stale: the frameloop is on demand
        const tip = hand.localToWorld(tmpTip.fromArray(phaserConfig.beamFrom));
        const ry = facingOf(npc); // with the sat turn, which `bearingPast` adds to: else each feeds the other
        arm.muzzleRight = (tip.x - npc.position.x) * Math.cos(ry) - (tip.z - npc.position.z) * Math.sin(ry);
        const along = tmpAlong.set(0, -1, 0).transformDirection(hand.matrixWorld); // the forearm, towards the hand
        /** Their phaser's own, looked up once: the frequencies it knows, and those it is dead to */
        const item = w.shields?.phaserOf(npc.key)?.meta;
        const part =
          dst === undefined
            ? null
            : (arm.hitAt ?? shotPast(arm, tip, tmpPart) ?? bodyPartPoint(dst, beam.to?.part ?? null, tmpPart));
        /** Where a shield between them stops it: of those their last cast passed */
        const stopped =
          part === null
            ? null
            : (w.shields?.stop(
                arm.sight.shields,
                tmpBody.set(npc.position.x, tip.y, npc.position.z),
                tip,
                part,
                item?.freqs,
              ) ?? null);
        const blocked = part === null ? null : acrossStop(arm, tip, part, tmpAcross);
        const stop =
          blocked !== null && (stopped === null || tip.distanceTo(blocked) < tip.distanceTo(stopped))
            ? blocked
            : stopped;
        const end = beamEnd(beam, tip, along, part, stop);
        const shown = eased(beam.shown.presence);
        const locked = eased(beam.locked.presence);
        // struck where the beam IS, not where it is headed: it glides there
        if (stopped !== null && stop === stopped) w.shields.strike(end, shown * locked);
        const { roomSlot, npcLit } = dst ?? npc;
        put(state.srcData, i, tip.x, tip.y, tip.z, shown);
        put(state.dstData, i, end.x, end.y, end.z, locked);
        put(state.roomData, i, npc.roomSlot.value, roomSlot.value, npc.npcLit.value, npcLit.value);

        hand.matrixWorld.decompose(tmpAt, tmpQuat, tmpScale);
        const roll = gunRoll(npc, hand);
        if (roll > 0) tmpQuat.multiply(tmpRoll.set(0, Math.sin(roll / 2), 0, Math.cos(roll / 2))); // about the forearm, its `y`
        const present = eased(beam.gun.presence);
        // scaled about the forearm's origin, their elbow: slid down it, so it shrinks into the hand instead
        tmpAt.addScaledVector(along, phaserConfig.grip * tmpScale.x * (1 - present));
        const sign = (item?.dead?.length ?? 0) > 0 ? -1 : 1; // negative: dead, see `gunNodes`
        put(state.gunData, i, tmpAt.x, tmpAt.y, tmpAt.z, tmpScale.x * present * sign);
        const flip = arm.armed === tmpQuat.w > 0 ? 1 : -1; // so `w > 0` says armed, see `gunNodes`
        put(state.quatData, i, tmpQuat.x * flip, tmpQuat.y * flip, tmpQuat.z * flip, tmpQuat.w * flip);
        return true;
      },
      strike(npc, arm) {
        const to = (arm.struck = arm.beam.to);
        const dst = to === null ? undefined : w.n[to.npcKey];
        if (to === null || dst === undefined) return;
        const part = bodyPartPoint(dst, to.part, tmpPart);
        const from = tmpBody.set(npc.position.x, part.y, npc.position.z);
        const end = shotPast(arm, from, tmpPast) ?? part;
        if (w.shields?.stop(arm.sight.shields, from, from, end, w.shields.phaserOf(npc.key)?.meta?.freqs) != null)
          return;
        const hand = handOf(npc, arm);
        hand?.updateWorldMatrix(true, false);
        const tip = hand?.localToWorld(tmpTip.fromArray(phaserConfig.beamFrom));
        if (tip !== undefined && acrossStop(arm, tip, end, tmpAcross) !== null) return; // as drawn
        const outcome = arm.shot?.to === to ? arm.shot.outcome : "hit";
        state.land(npc, dst, to.part, outcome);
        // the burst ends where it landed, rather than following them as they writhe. One passing them runs on
        if (end === part) {
          const met = outcome === "shielded" ? (w.npcShields?.flash(dst, to.part, from) ?? part) : part;
          arm.hitAt = (arm.hitAt ?? new THREE.Vector3()).copy(met);
        }
        arm.target = arm.firedSecs = null;
        w.hud?.update();
      },
      land(npc, dst, part, outcome) {
        if (outcome === "hit") w.npc.hit(dst.key, part);
        w.events.next({ key: "npc-shot", by: npc.key, npcKey: dst.key, part, outcome });
        if (outcome !== "hit" && npc.key === w.player.key) w.hud?.say(outcome);
        // lowered here, not by `disarm`, whose `sync` would tick again mid-tick
        const theirs = state.arms.get(dst.key);
        if (outcome === "hit" && dst.anim.hurt !== null && theirs !== undefined) lower(theirs);
      },
      aimShot(npc, dst, shot) {
        if (shot.outcome === "dodged" && dst.anim.posture === "lie") shot.outcome = "hit"; // no dodging in bed
        const aim = shot.outcome === "dodged" ? dodgeAimOf(dst, shot.to.part) : shot.to.part;
        const through = bodyPartPoint(dst, aim, new THREE.Vector3());
        if (shot.outcome === "dodged") {
          // where their part will be once they have turned to face it. No dodge of theirs clears it from here: missed
          const turn = w.npc.dodge(dst.key, shot.to.part, npc.point);
          if (turn === null) shot.outcome = "missed";
          else if (turn !== 0) through.sub(dst.position).applyAxisAngle(yAxis, turn).add(dst.position);
        }
        return through;
      },
      shoot(npc, arm, to) {
        const shot: ArmShot = { to, outcome: state.outcomeOf(npc.key, to), through: null, past: null };
        arm.shot = shot;
        const dst = w.n[to.npcKey];
        if (dst === undefined) return;
        const through = state.aimShot(npc, dst, shot);
        if (shot.outcome !== "missed" && shot.outcome !== "dodged") return;
        // dodged, it passes through the middle of their part: they move, it does not
        if (shot.outcome === "missed") passWide(through, npc.position, dst.position);
        shot.through = through;
        const length = Math.hypot(through.x - npc.position.x, through.z - npc.position.z) || 1;
        const dir = { x: (through.x - npc.position.x) / length, y: (through.z - npc.position.z) / length };
        void wallBeyond(w, dst.point, dir).then((past) => {
          shot.past = past;
          w.r3f?.invalidate();
        });
      },
      respawned(npcKey) {
        const [arm, npc] = [state.arms.get(npcKey), w.n?.[npcKey]];
        if (arm?.armed !== true || npc === undefined) return;
        state.disarm(npcKey);
        // at rest before they fade back in, so it never shows where it was
        if (isPhaserPose(npc.anim.upper.key)) npc.anim.setUpper(null, { fadeSecs: phaserConfig.snapSecs });
      },
      sync() {
        state.onTick(w.disabled === true); // paused: nothing fades, so a change is at once
        w.r3f?.invalidate();
        w.hud?.update();
      },
      wield(npc, arm, delta) {
        const secs = w.gameTime.now();
        // one shot only: lowered once it is over, or given up on
        const over = arm.target === null && arm.beam.locked.presence === 0; // its beam faded first
        if (arm.lowerAt !== null && arm.armed === true && (over || secs >= arm.lowerAt)) {
          lower(arm);
          arm.lowerAt = null;
          w.hud?.update();
        }
        const { anim } = npc;
        const lain = anim.posture === "lie";
        const onKey = arm.target?.npcKey ?? arm.toward;
        /** Whom they are on, else pointing at */
        const on = onKey === null ? undefined : w.n[onKey];
        /** They aim at them only within reach: sat, within `sitTurn`'s aim, lain, from a pose whose `lieAim` holds them */
        let inReach = lain === false && (on === undefined || anim.canAimAt(on.point));
        if (arm.armed === true && lain === true) {
          // so the arm stays there once they are gone, e.g. shot
          if (on !== undefined) arm.pointAt = Object.assign(arm.pointAt ?? { x: 0, y: 0 }, on.point);
          // they roll to point there, if they can
          const onto = arm.pointAt === null ? null : anim.lieAimPoseFor(arm.pointAt);
          if (onto !== null) anim.rollOnto(onto);
          inReach = on !== undefined && onto === anim.pose;
        }
        const { armed } = arm;
        const target = armed === true && arm.target !== null ? w.n[arm.target.npcKey] : undefined;
        state.recast(npc, arm, target, secs);
        /** Locked on someone the last cast looked for and could not see: drawn in until it can */
        const blind =
          target !== undefined &&
          arm.casting === false &&
          arm.sight.inSight === false &&
          arm.cast?.target === target.key;
        /** Their arm at full reach would meet a shield: drawn in, as from a wall */
        const shielded =
          armed === true &&
          armEnds(npc, arm).some((end) => w.shields?.reaches(npc.point, end, w.shields.freqsOf(npc.key)) === true);
        if (shielded && arm.shielded === false && npc.key === w.player.key) w.hud?.say("phaser suppressed");
        arm.shielded = shielded;
        // polled through their room, and past a door they are near: the crowd's neighbours stop short of the gun
        const pollSecs = npc.key === w.player.key ? phaserConfig.sampleSecs : phaserConfig.npcPollSecs;
        if (armed === true && secs - arm.npcPolledSecs >= pollSecs) {
          arm.npcHit = armMeetsNpc(w, npc, arm, secs);
          arm.npcPolledSecs = secs - Math.random() * pollSecs * 0.5; // jittered, so the armed do not all poll on one frame
        }
        /** Stood or crouched, the gun's height: sat or lain, obstacles are what they sit or lie at */
        const gunY = anim.posture === "stand" ? anim.headY - phaserConfig.gunBelowHead : null;
        // the obstacles as they stand now, so a crouch draws in at once
        arm.armHit = arm.reach.wallHit;
        /** An obstacle a raise or lower would swing the gun through: between the hand at rest and the gun raised */
        let swingHit = false;
        if (gunY !== null) {
          for (const { top, bottom } of arm.reach.obstacles) {
            if (gunY > bottom - phaserConfig.gunClear && gunY < top + phaserConfig.gunClear) arm.armHit = true;
            if (top > gunY - phaserConfig.restBelowGun && bottom < gunY) swingHit = true;
          }
        }
        const blocked = armed === true && (arm.armHit === true || shielded || blind || arm.npcHit);
        // lain, only by a cast as they lie now: a roll leaves the last one stale
        if (blocked === true && (lain === false || isCastCurrent(arm, npc, target) === true)) {
          arm.holdUntil = secs + phaserConfig.holdSecs;
        }
        const avoid = armed === true && arm.holdUntil > secs;

        // the pose, over their right arm — only ours, never another's e.g. a reach
        /** Lain, stowed instead of drawn in: unless the arm is on top, free to draw in */
        const stowed = avoid && lain && lieAim[anim.pose]?.drawIn !== true;
        /** Crouched and not raised, the gun is held up out of the way */
        const tucked = armed === false && anim.crouched && state.holds(npc.key);
        const goal = tucked
          ? phaserConfig.avoid
          : armed === false || stowed
            ? null
            : avoid
              ? phaserConfig.avoid
              : phaserConfig.pose;
        const sat = anim.posture === "sit";
        const shown = anim.upper.target === 1 ? anim.upper.key : null;
        const settled = anim.upper.blend === 1 && anim.upper.swap === 1;
        /** Stood before an obstacle its swing would meet, the arm goes by `avoid` */
        const via = swingHit && anim.posture === "stand" && tucked === false;
        // raised from rest only once a cast says which way
        const waiting = armed === true && goal === phaserConfig.pose && shown === null && arm.casting === true;
        const pose = waiting ? null : via ? byAvoid(goal, shown, settled) : goal;
        if (pose === null) {
          // raised still, lain, it is stowed: slowly, as from a wall
          if (isPhaserPose(shown)) anim.setUpper(null, { fadeSecs: armed ? phaserConfig.stowSecs : undefined });
        } else if (pose !== shown && (shown === null || isPhaserPose(shown))) {
          // in before the hand goes through — and a raise from rest keeps the clip's own pace
          const swapSecs =
            pose === phaserConfig.avoid
              ? phaserConfig[anim.crouched ? "quickDrawInSecs" : "drawInSecs"]
              : shown === null
                ? undefined
                : phaserConfig.drawOutSecs;
          anim.setUpper(pose, { swapSecs, past: sat });
        }

        // the stance — theirs to stand in, and only ours to put back. Sat, lain or crouched, the seat's, bed's or crouch's
        /** Past an obstacle, not before the arm is up: the stance's own arm would swing the gun through it */
        const armUp = via === false || arm.ownIdle !== null || (isPhaserPose(anim.upper.key) && settled);
        const stance =
          armed === true && anim.posture === "stand" && anim.crouched === false && armUp ? phaserConfig.pose : null;
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
        if (sat === true) {
          // sat they turn their head, not round: and only ours to put back
          if (face.aim !== null && face.aim === arm.ownAim) face.aim = arm.ownAim = null;
          if (target !== undefined) anim.turnTo(bearingPast(npc, target, arm.muzzleRight));
          else if (arm.ownTurn === true && armed === false) anim.turnTo(null); // kept whilst raised
          arm.ownTurn = target !== undefined || (arm.ownTurn === true && armed === true);
        } else if (lain === true) {
          // lain they do not turn: their arm and head do
          if (face.aim !== null && face.aim === arm.ownAim) face.aim = arm.ownAim = null;
        } else if (face.aim === null || face.aim === arm.ownAim) {
          /** On a move told not to strafe, whose forward gait a held aim would slide */
          const forwardOnly = npc.isMoving() && anim.strafe !== true && anim.strafeFollowsAim !== true;
          if (target !== undefined) arm.lockAim.at = bearingPast(npc, target, arm.muzzleRight);
          face.aim = arm.ownAim =
            target !== undefined ? arm.lockAim : armed === true && forwardOnly === false ? heldAim : null;
        }

        // the gun in hand, and the beam: locked on whilst aiming and in sight
        const { beam } = arm;
        arm.armAim ??= { at: beam.at, from: muzzle, weight: 0 };
        arm.gliding = false;
        /** Raised, or still coming down: lowered at once, a pose drawn stood would swing the arm up */
        const aiming = armed === true || isPhaserPose(anim.upper.key);
        if (aiming === true && (sat === true || lain === true)) {
          // sat or lain the arm points as it comes up or down, swung far from the pose, which was drawn stood
          const at = glideArmAt(npc, arm, armAimAt(npc, arm, on, inReach, tmpArmWant), delta);
          // drawn in, it gives way to the pose as that swaps in, and takes over again as it swaps back
          const { key, swap } = anim.upper;
          const s = swap * swap * (3 - 2 * swap);
          Object.assign(arm.armAim, { at, weight: key === phaserConfig.avoid ? 1 - s : s, maxRad: Math.PI });
        } else {
          // the arm follows the beam
          Object.assign(arm.armAim, { at: beam.at, weight: eased(beam.shown.presence), maxRad: undefined });
        }
        arm.armAim.head = sat === true ? 0 : undefined; // sat, their turn has the head on them already
        if (anim.upper.aim === null || anim.upper.aim === arm.armAim) anim.upper.aim = aiming ? arm.armAim : null;
        // in hand whilst they carry it and stand, raised or lowered — or still armed, having just lost it
        beam.gun.target = armed === true || state.holds(npc.key) ? 1 : 0;
        // gone at once between the two halves of a teleport, and as they sit or lie, unless raised: stowed lain, it stays in hand
        const seated = w.npc.npcToDoable[npc.key] != null && armed === false;
        if (leaving(npc)) beam.gun.target = beam.gun.presence = 0;
        else if (seated) {
          // lowered sat, it shrinks into the hand only as the arm comes back down
          const lowering = isPhaserPose(anim.upper.key) ? anim.upper.blend / phaserConfig.stowBlend : 0;
          beam.gun.target = lowering > 0 ? 1 : 0;
          beam.gun.presence = Math.min(beam.gun.presence, lowering);
        } else if (beam.gun.target === 1 && beam.gun.presence === 0) beam.gun.presence = 1; // e.g. armed throughout
        const locking = target !== undefined && arm.sight.inSight === true && inReach;
        /** The arm is all the way up: no beam on its way there, nor any left as it comes down */
        const raised = armed === true && anim.upper.key === phaserConfig.pose && anim.upper.blend === 1;
        beam.shown.target = locking && avoid === false && raised ? 1 : 0;
        if (armed === false) beam.shown.presence = beam.locked.presence = 0;
        if (avoid === false) beam.next = locking ? arm.target : null;

        // a shot is short: then they let go of whom they were on, still drawn
        if (target === undefined || beam.locked.presence === 0) arm.firedSecs = null;
        else if (secs - (arm.firedSecs ??= secs) > phaserConfig.fireSecs) {
          arm.target = arm.firedSecs = null;
          w.hud?.update();
        }
      },
      recast(npc, arm, target, secs) {
        if (arm.armed === false || arm.casting === true || secs - arm.castSecs < phaserConfig.sampleSecs) return;
        if (isCastCurrent(arm, npc, target) === true) return; // nothing has changed: neither they, their target, nor a door
        const { x, z } = npc.position;
        const ry = armBearingOf(npc, arm);
        const [tx, tz] = target === undefined ? [0, 0] : [target.position.x, target.position.z];

        const cast = { x, z, ry, tx, tz, target: target?.key ?? null };
        arm.cast = cast;
        arm.castSecs = secs;
        arm.casting = true;
        let from = muzzleAt(npc, arm);
        // off the map throws: read as blocked
        const arms = Promise.all(
          armEnds(npc, arm).map((end) =>
            w.e.raycast(npc.point, end).then(
              ({ hit, obstacles }) => ({ hit: hit !== null, obstacles }),
              () => ({ hit: true, obstacles: [] }),
            ),
          ),
        ).then((rays): ArmReach => ({ obstacles: distinctObstacles(rays), wallHit: rays.some((r) => r.hit) }));
        void Promise.all([
          arms,
          target === undefined
            ? { ...arm.sight, inSight: false } // kept: a beam let go of still fades against them
            : w.e
                .raycast(from, bodyPartPoint(target, arm.target?.part ?? null, tmpPart))
                .catch(() => w.e.raycast((from = npc.point), target.point)) // its muzzle beyond a wall
                .then(
                  ({ hit, obstacles, shields }): ArmSight => ({
                    across: obstacles,
                    from,
                    inSight: hit === null,
                    shields,
                  }),
                  (): ArmSight => ({ across: [], from, inSight: false, shields: [] }),
                ),
        ] as const)
          .then(([reach, sight]) => arm.cast === cast && Object.assign(arm, { reach, sight })) // else respawned since
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
    const sub = w.events.subscribe({
      next(e) {
        // a door opening or closing may clear an arm or a line of sight
        if (e.key === "door-open" || e.key === "door-closed") state.markDirty();
        // whoever carries one has it in hand: on taking one up, standing up, or arriving
        else if (e.key === "carried" || e.key === "npc-do" || e.key === "spawned") state.hold(e.npcKey);
        if (e.key === "spawned" && e.spawns > 1) state.respawned(e.npcKey);
        else if (e.key === "spawned-many") e.npcKeys.forEach(state.hold);
      },
    });
    for (const npcKey in w.e.carried) state.hold(npcKey); // those here already
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
  tickedSecs: number;

  /** Radians their arm points off `at`, sat or lain — `null` unless it aims by `armAt` */
  aimOff(npcKey: string, at: Geom.VectJson): null | number;
  /** Arm them, locked on `at` an npc's `part` — no `at` unlocks */
  /** `once`: lowered again once the shot is over. `toward`: sat or lain, whom they point at without locking on */
  arm(npcKey: string, opts?: { at?: null | string; part?: null | string; once?: boolean; toward?: string }): void;
  /** Their pose, stance and aim are let go of, and the gun and beam fade */
  disarm(...npcKeys: string[]): void;
  /** Writes their gun and beam as instance `i`, the beam to `dst` if any — `false` with no forearm to hold it */
  draw(npc: Npc, arm: ArmEntry, dst: undefined | Npc, i: number): boolean;
  /** Their entry, made if absent */
  ensure(npcKey: string): ArmEntry;
  /** Gives them an entry if they hold one and have none: told by events, not looked for each tick */
  hold(npcKey: string): void;
  /** Carries one and stands, so has it in hand — raised or not */
  holds(npcKey: string): boolean;
  /** Armed, the arm done easing onto where it points, and not rolling over in bed */
  isAimed(npcKey: string): boolean;
  isArmed(npcKey: string): boolean;
  /** Raised, and nothing in its way as they stand now: not drawn in, nor about to be */
  isClear(npcKey: string): boolean;
  /** Armed, and drawn in: `phaser_aim_avoid`, or lain, stowed */
  isDrawnIn(npcKey: string): boolean;
  /** Armed, and the arm all the way up */
  isRaised(npcKey: string): boolean;
  /** Armed, and locked on someone */
  isLocked(npcKey: string): boolean;
  /** Lowers it, returning what raises it again as it was: `null` if it was not raised */
  lowerAwhile(npcKey: string): null | (() => void);
  /** Look again at every arm and line of sight, e.g. a door changed */
  markDirty(): void;
  /** How a shot at `to` by `npcKey` ends: the hud's debug badge decides, else jsh, else it hits */
  outcomeOf(npcKey: string, to: BeamTarget): JshCli.ShotOutcome;
  /** Armed, they point towards `at` on the ground, not at whom a focus did: lain, as near as their pose aims */
  pointAt(npcKey: string, at: Geom.VectJson): void;
  /** The gun's colour and the beam's gain, ink and blending from the theme — called by `onChangeTheme` */
  syncTheme(): void;
  /** Armed, unlocked, else disarmed: returns whether they now are */
  toggle(npcKey: string): boolean;
  /** `instant` lands every fade at once */
  onTick(instant?: boolean): void;
  /** Their beam has reached its end: its effect on whom it was at, unless a shield stops it */
  strike(npc: Npc, arm: ArmEntry): void;
  /** Their beam is locking on to `to`: decides the shot, and where one passing them ends */
  shoot(npc: Npc, arm: ArmEntry, to: BeamTarget): void;
  /** Settles `shot`'s outcome against them: in bed, or a dodge that clears it. Returns where the beam aims through */
  aimShot(npc: Npc, dst: Npc, shot: ArmShot): THREE.Vector3;
  /** A shot by `npc` reached `dst`'s `part`: its effect, its event, and a word to the player if it did not hit */
  land(npc: Npc, dst: Npc, part: null | string, outcome: JshCli.ShotOutcome): void;
  sync(): void;
  /** Their pose, stance, aim, gun and beam from their entry */
  wield(npc: Npc, arm: ArmEntry, delta: number): void;
  /** Raycast `reach` ahead and to the target — but only once something has changed, and one at a time */
  recast(npc: Npc, arm: ArmEntry, target: undefined | Npc, secs: number): void;
  /** Respawned armed, they lower it at once: the gun is never left raised into a wall it was put beside */
  respawned(npcKey: string): void;
};

type ArmEntry = {
  /** The arm's aim we set, down the beam */
  armAim: null | UpperAim;
  /** Where the arm points sat or lain, ahead of any beam — see `armAimAt` */
  armAt: THREE.Vector3;
  armed: boolean;
  /** A wall, closed door, or obstacle at the gun's height, within reach ahead: worked out each tick */
  armHit: boolean;
  beam: Beam;
  /** Where they stood, faced, and their target stood, when last cast — `null` is to cast again */
  cast: null | { x: number; z: number; ry: number; tx: number; tz: number; target: null | string };
  casting: boolean;
  /** World seconds of the last cast */
  castSecs: number;
  /** World seconds at which their beam reached out, whilst it does */
  firedSecs: null | number;
  /** The arm is still easing onto where it points — see `glideArmAt` */
  gliding: boolean;
  /** Their right forearm, and the model it was found in */
  hand: null | { of: Npc["group"]; bone: THREE.Object3D };
  /** Where the lock hit, whilst its beam fades: held there */
  hitAt: null | THREE.Vector3;
  /** World seconds they stay drawn in until */
  holdUntil: number;
  /** The stance they stood in before ours */
  idleBefore: null | AnimationClipKey;
  /** npcKey */
  key: string;
  /** The aim at their target, kept: its bearing is rewritten each tick */
  lockAim: { at: number; rate: number; untilRest: boolean };
  /** World seconds a one-off shot is lowered by at the latest, whilst there is one */
  lowerAt: null | number;
  /** Metres their muzzle sits to one side of them, as last drawn — their facing allows for it */
  muzzleRight: number;
  /** Someone within reach of the arm, as last polled — see `armMeetsNpc` */
  npcHit: boolean;
  /** World seconds of that poll */
  npcPolledSecs: number;
  /** The aim we set, so we replace or clear only ours */
  ownAim: Npc["anim"]["face"]["aim"];
  /** The stance we stand them in */
  ownIdle: null | AnimationClipKey;
  /** We turned them sat, so we turn them back */
  ownTurn: boolean;
  /** Where they last pointed, on the ground: by `pointAt`, or lain, at whom they were on */
  pointAt: null | Geom.VectJson;
  /** The last cast along the arm */
  reach: ArmReach;
  /** A shield within reach ahead, that their phaser is not let through */
  shielded: boolean;
  /** The shot its lock is, decided as it locks on */
  shot: null | ArmShot;
  /** The last cast along the beam */
  sight: ArmSight;
  /** The lock already struck with, so one shot hits once */
  struck: null | BeamTarget;
  /** Whom they lock on to whilst armed and in sight */
  target: null | BeamTarget;
  /** Whom they point at without locking on, sat or lain — see `arm` */
  toward: null | string;
};

/** Within reach ahead of the arm, as last cast */
type ArmReach = {
  /** The obstacles there, at any height */
  obstacles: JshCli.RaycastResult["obstacles"];
  /** A wall or closed door there */
  wallHit: boolean;
};

/** Between the muzzle at full aim and their target's part, as last cast */
type ArmSight = {
  /** The obstacles it crosses on the ground */
  across: JshCli.RaycastResult["obstacles"];
  /** Where the cast began */
  from: Geom.VectJson;
  /** Nothing between them and their target */
  inSight: boolean;
  /** Decor keys of the shields between them */
  shields: string[];
};

type ArmShot = {
  to: BeamTarget;
  outcome: JshCli.ShotOutcome;
  /** Missed or dodged, where it passes them. It runs on to `past`, the wall beyond on the ground, once that is found */
  through: null | THREE.Vector3;
  past: null | Geom.VectJson;
};

/** The bone a dodged shot at `part` aims at: sat, an upper arm rather than the hand by the thigh */
function dodgeAimOf(dst: Npc, part: null | string) {
  const region = hitConfig.region[part ?? ""];
  return (
    (region === undefined ? undefined : hitConfig.dodgeAim[dst.anim.posture as "stand" | "sit" | "lie"]?.[region]) ??
    part
  );
}

/** Moves `through` to `missBy` from their `middle`, on the part's side: a miss never passes through them */
function passWide(through: THREE.Vector3, from: THREE.Vector3, middle: THREE.Vector3) {
  const length = Math.hypot(through.x - from.x, through.z - from.z) || 1;
  const [px, pz] = [-(through.z - from.z) / length, (through.x - from.x) / length];
  const across = (through.x - middle.x) * px + (through.z - middle.z) * pz;
  const side = Math.abs(across) < 0.01 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(across);
  through.x += px * (side * phaserConfig.missBy - across);
  through.z += pz * (side * phaserConfig.missBy - across);
}

/** Where a shot passing them ends: on through them to the wall or floor beyond. `null` for any other shot */
function shotPast(arm: ArmEntry, from: THREE.Vector3, out: THREE.Vector3) {
  const { shot } = arm;
  if (shot === null || shot.through === null || shot.to !== arm.beam.to) return null;
  const { through, past } = shot;
  const run = Math.max(Math.hypot(through.x - from.x, through.z - from.z), 1e-3);
  let s =
    past === null
      ? 1 + phaserConfig.passStub / run // not found yet
      : Math.max(1, Math.hypot(past.x - from.x, past.y - from.z) / run);
  if (through.y < from.y) s = Math.min(s, from.y / (from.y - through.y)); // the floor first
  return out.lerpVectors(from, through, s);
}

/** Where a ray from `from` along `dir` meets a wall, within `passMax` metres. `null` where it cannot be cast */
async function wallBeyond(w: import("./World").State, from: Geom.VectJson, dir: Geom.VectJson) {
  for (let d = phaserConfig.passMax; d >= 1; d /= 2) {
    const to = { x: from.x + dir.x * d, y: from.y + dir.y * d };
    if (w.findRoomContaining(to, true) === null) continue; // off the map: nearer
    try {
      return (await w.e.raycast(from, to)).hit ?? to;
    } catch {
      return null;
    }
  }
  return null;
}

/** Does their gun at full aim meet someone in their room: their body, or their arm whilst raised? */
function armMeetsNpc(w: import("./World").State, npc: Npc, arm: ArmEntry, secs: number) {
  const ours = gunLine(npc, arm);
  const [mx, mz] = [(ours[0] + ours[2]) / 2, (ours[1] + ours[3]) / 2];
  const { armWidth, bodyRadius, reach } = phaserConfig;
  /** Further off than this either way, neither their body nor their gun is in reach */
  const far = 1.5 * reach + npcDims.agentRadius + 2 * armWidth;
  /** The player gives way to no npc's arm */
  const player = npc.key === w.player.key;
  /** Those near a door they are near, either side: the arm may reach through it */
  const atDoors = [...(w.e.npcToDoors[npc.key]?.nearby ?? [])].flatMap((gdKey) => [
    ...(w.e.doorToNpcs[gdKey]?.nearby ?? []),
  ]);
  const others = [
    ...w.e.getNpcsInReach(npc.key, 0),
    ...atDoors.flatMap((key) => (key === npc.key ? [] : (w.n[key] ?? []))),
  ];
  return others.some((other) => {
    const p = other.position;
    if (Math.abs(p.x - mx) > far || Math.abs(p.z - mz) > far) return false;
    const body = (other.anim.posture === "stand" ? bodyRadius : npcDims.agentRadius) + armWidth;
    if (toSeg(p.x, p.z, ours) < body) return true;
    if (player === true) return false;
    const theirs = w.phasers.arms.get(other.key);
    // only an arm up now: of two that would meet, whoever raised first keeps it
    if (theirs === undefined || theirs.armed === false || theirs.holdUntil > secs) return false;
    return segsApart(ours, gunLine(other, theirs)) < 2 * armWidth;
  });
}

/**
 * Their gun at full aim, on the ground. Stood, from the elbow to the muzzle.
 * Else `reach` from their right shoulder, which lain is far from their middle
 */
function gunLine(npc: Npc, arm: ArmEntry): Seg {
  const ry = armBearingOf(npc, arm);
  const [fx, fz] = [-Math.sin(ry), -Math.cos(ry)];
  if (npc.anim.posture === "stand") {
    const { ahead, from, right } = phaserConfig.gun;
    const [x, z] = [npc.position.x - fz * right, npc.position.z + fx * right];
    return [x + fx * from, z + fz * from, x + fx * ahead, z + fz * ahead];
  }
  const { x, z } = npc.anim.upper.bones[0]?.bone.getWorldPosition(tmpShoulder) ?? npc.position;
  return [x, z, x + fx * phaserConfig.reach, z + fz * phaserConfig.reach];
}

/** Their muzzle at full aim, on the ground */
function muzzleAt(npc: Npc, arm: ArmEntry): Geom.VectJson {
  const [, , x, y] = gunLine(npc, arm);
  return { x, y };
}

/** Where the beam from `tip` to `end` first meets an obstacle it crosses, short of the part's own depth: else `null` */
function acrossStop(arm: ArmEntry, tip: THREE.Vector3, end: THREE.Vector3, out: THREE.Vector3) {
  const run = Math.hypot(end.x - tip.x, end.z - tip.z) || 1e-6;
  const last = 1 - phaserConfig.partDepth / Math.max(run, phaserConfig.partDepth);
  // measured from where the cast began: the tip moves, e.g. as the arm comes down
  const { across, from } = arm.sight;
  const on = ((tip.x - from.x) * (end.x - tip.x) + (tip.z - from.y) * (end.z - tip.z)) / run;
  let first = last;
  for (const { dist, leave, top, bottom } of across) {
    const [t0, t1] = [Math.max(0, (dist - on) / run), Math.min((leave - on) / run, first)];
    if (t0 >= t1) continue;
    const [h0, h1] = [tip.y + (end.y - tip.y) * t0, tip.y + (end.y - tip.y) * t1];
    if (Math.max(h0, h1) < bottom || Math.min(h0, h1) > top) continue;
    // in at its side, else down through its top or up through its underside
    first = h0 >= bottom && h0 <= top ? t0 : t0 + ((t1 - t0) * ((h0 > top ? top : bottom) - h0)) / (h1 - h0);
  }
  return first === last ? null : out.lerpVectors(tip, end, first);
}

/** Metres from `(px, pz)` to the segment `s` */
function toSeg(px: number, pz: number, s: Seg) {
  const [dx, dz] = [s[2] - s[0], s[3] - s[1]];
  const t = THREE.MathUtils.clamp(((px - s[0]) * dx + (pz - s[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(px - s[0] - t * dx, pz - s[1] - t * dz);
}

/** Metres between two segments: zero when they cross */
function segsApart(a: Seg, b: Seg) {
  const side = (px: number, pz: number, s: Seg) => Math.sign((s[2] - s[0]) * (pz - s[1]) - (s[3] - s[1]) * (px - s[0]));
  if (side(a[0], a[1], b) !== side(a[2], a[3], b) && side(b[0], b[1], a) !== side(b[2], b[3], a)) return 0;
  return Math.min(toSeg(a[0], a[1], b), toSeg(a[2], a[3], b), toSeg(b[0], b[1], a), toSeg(b[2], b[3], a));
}

/** A segment on the ground: `x0, z0, x1, z1` */
type Seg = [number, number, number, number];

/** Whether their last cast was made as things stand: they, and their target, where they were then */
function isCastCurrent(arm: ArmEntry, npc: Npc, target: undefined | Npc) {
  const { cast } = arm;
  if (cast === null || cast.target !== (target?.key ?? null)) return false;
  const near = (ax: number, az: number, bx: number, bz: number) =>
    Math.hypot(ax - bx, az - bz) <= phaserConfig.recastMoved;
  const [tx, tz] = target === undefined ? [0, 0] : [target.position.x, target.position.z];
  return (
    near(cast.x, cast.z, npc.position.x, npc.position.z) &&
    Math.abs(deltaAngle(cast.ry, armBearingOf(npc, arm))) <= phaserConfig.recastTurned &&
    near(cast.tx, cast.tz, tx, tz)
  );
}

/** The obstacles the rays passed, each once: both rays usually pass the same */
function distinctObstacles(rays: { obstacles: JshCli.RaycastResult["obstacles"] }[]) {
  const byKey = new Map(
    rays.flatMap(({ obstacles }) => obstacles.map((o) => [`${o.gmId} ${o.obstacleId}`, o] as const)),
  );
  return [...byKey.values()];
}

/** Where both sides of their arm end at arm's length, on the ground, led by their velocity. Stood, the gun is to their right */
function armEnds(npc: Npc, arm: ArmEntry): Geom.VectJson[] {
  const ry = armBearingOf(npc, arm);
  const [fx, fz] = [-Math.sin(ry), -Math.cos(ry)];
  const [vx, , vz] = npc.agent?.velocity ?? [0, 0, 0];
  const { armWidth, leadSecs, reach } = phaserConfig;
  const [x, z] = [npc.position.x + vx * leadSecs + fx * reach, npc.position.z + vz * leadSecs + fz * reach];
  if (npc.anim.posture !== "stand") return [{ x, y: z }];
  const right = phaserConfig.gun.right + armWidth;
  return [
    { x, y: z },
    { x: x - fz * right, y: z + fx * right },
  ];
}

/** The way they aim: turned sat, or ahead of how they lie */
const facingOf = (npc: Npc) => npc.anim.aimBearing() ?? npc.rotation.y;

/** The way their arm points: lain, anywhere in their pose's arc, so at `armAt` whilst it aims by it */
const armBearingOf = (npc: Npc, arm: ArmEntry) =>
  arm.armAim?.at === arm.armAt ? npc.anim.bearingOf({ x: arm.armAt.x, y: arm.armAt.z }) : facingOf(npc);

/**
 * Where one sat or lain points their arm: at `on`'s part or chest whilst in reach. Else ahead the way they aim, at the
 * height of their head. Lain, as near `arm.pointAt` as their pose aims
 */
function armAimAt(npc: Npc, arm: ArmEntry, on: undefined | Npc, inReach: boolean, out: THREE.Vector3) {
  if (on !== undefined && inReach === true) return bodyPartPoint(on, arm.target?.part ?? "chest", out);
  const { anim } = npc;
  const ry = (anim.posture === "lie" && arm.pointAt !== null ? anim.lieAimBearing(arm.pointAt) : null) ?? facingOf(npc);
  const { x, y, z } = npc.position;
  const ahead = phaserConfig.aimAhead;
  return out.set(x - Math.sin(ry) * ahead, y + npc.anim.headY, z - Math.cos(ry) * ahead);
}

/** Eases `arm.armAt` to `want` over `delta` seconds. Newly aimed by it, from where the gun points now */
function glideArmAt(npc: Npc, arm: ArmEntry, want: THREE.Vector3, delta: number) {
  const hand = arm.armAim?.at === arm.armAt ? null : handOf(npc, arm);
  if (hand !== null) {
    hand.updateWorldMatrix(true, false);
    const tip = hand.localToWorld(tmpTip.copy(muzzle));
    const along = tmpAlong.set(0, -1, 0).transformDirection(hand.matrixWorld);
    arm.armAt.copy(tip).addScaledVector(along, tip.distanceTo(want));
  }
  arm.armAt.lerp(want, 1 - Math.exp(-delta / phaserConfig.armGlideSecs));
  const distSq = arm.armAt.distanceToSquared(want);
  arm.gliding = Math.sqrt(distSq) > Math.tan(phaserConfig.armAimedRad) * want.distanceTo(npc.position);
  if (distSq < 1e-6) arm.armAt.copy(want);
  else npc.w.r3f?.invalidate(); // still on its way: the frameloop is on demand
  return arm.armAt;
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
  /** Seconds of their velocity a wall is looked for ahead of, so the arm is drawn in before it gets there */
  leadSecs: 0.3,
  /** Metres the gun is below their head's pivot at full aim, stood or crouched */
  gunBelowHead: 0.07,
  /** Metres the gun must clear an obstacle by, above or below */
  gunClear: 0.05,
  /** Metres the hand hangs at rest below the gun raised, which a raise or lower swings between */
  restBelowGun: 0.5,
  /** Metres from the arm's line to its side, gun included, that someone within reach must keep clear of */
  armWidth: 0.1,
  /** Metres of a standing body's half-width, which the arm must miss: less than their crowd agent's radius */
  bodyRadius: 0.15,
  /** Metres of a body part before its middle, in which nothing hides it: e.g. a thigh on its seat */
  partDepth: 0.12,
  /** Metres of a stood npc's gun at full aim, in their aim's frame: ahead to the elbow and muzzle, and to their right */
  gun: { from: 0.32, ahead: 0.75, right: 0.19 },
  /** Metres ahead one sat or lain points with nobody to aim at */
  aimAhead: 5,
  /** The gun's muzzle, where the beam leaves, off the right forearm — its `+x` is up whilst aiming — in model units */
  beamFrom: [0.12, -0.54, 0] as [number, number, number],
  /** How far down the forearm the hand holds it, which it fades into and out of — model units */
  grip: 0.29,
  fadeSecs: 0.3,
  /** Sat, the gun shrinks into the hand over the last of the arm's way down, as this much of its blend */
  stowBlend: 0.25,
  /** Seconds the arm takes to swing most of the way onto a new point, sat or lain — see `glideArmAt` */
  armGlideSecs: 0.15,
  /** Radians off where it is headed the arm counts as aimed, though it eases on — see `isAimed` */
  armAimedRad: Math.PI / 60,
  /** Metres from their middle a miss passes, on the side of the part */
  missBy: 0.4,
  /** Metres a miss looks along for a wall, and runs on past them until it finds one */
  passMax: 12,
  passStub: 1,
  /** Seconds a shot lasts, before they let go of their target */
  fireSecs: 1.5,
  /** Seconds a one-off shot may take before it is lowered regardless, e.g. never in sight */
  onceSecs: 4,
  /** Radians about the right forearm between an arm at rest and the pose's — see `onTick` */
  restRoll: Math.PI / 2,
  /** Seconds they stay drawn in at least — longer whilst something stays in reach */
  holdSecs: 0.5,
  drawInSecs: 0.3,
  /** Seconds to draw in crouched: the gun drops with them, and is nearer what it meets */
  quickDrawInSecs: 0.12,
  /** An arm put at rest at once, e.g. on a respawn */
  snapSecs: 0.01,
  /** Seconds the arm takes to come down, stowed lain */
  stowSecs: 0.8,
  /** Seconds back out to the aim, once clear */
  drawOutSecs: 0.2,
  /** Seconds between raycasts at most, and only once they, their target or a door has changed */
  sampleSecs: 0.1,
  /** Seconds between looks for someone in the way of an npc's arm, sat or lain: the player's are `sampleSecs` apart */
  npcPollSecs: 0.3,
  /** Metres moved, or radians turned, that call for another raycast */
  recastMoved: 0.05,
  recastTurned: 0.05,
} as const;

/** The arm's next pose towards `goal`, never straight between rest and the aim: by `avoid`, and on once that is in */
function byAvoid(goal: null | AnimationClipKey, shown: null | AnimationClipKey, settled: boolean) {
  const crossing = goal !== shown && goal !== phaserConfig.avoid && (shown === null || shown === phaserConfig.pose);
  return crossing || (shown === phaserConfig.avoid && settled === false) ? phaserConfig.avoid : goal;
}

/** Lowers it, forgetting whom it was on or pointed at: raised again, it is on nobody */
function lower(arm: ArmEntry) {
  Object.assign(arm, { armed: false, target: null, toward: null, pointAt: null });
}

/** Faded right out, mid-teleport: in their hand until then, and again as they fade back in */
const leaving = (npc: Npc) => npc.colorScale.value === 0;

/** Whether nothing of them is drawn: their room out of view, and they not lit of themselves — as `seenBy` */
const unseen = (w: import("./World").State, npc: Npc) =>
  w.view.fadeRoomsFx.isHidden(npc.roomSlot.value) === true && npc.npcLit.value * w.view.litNpcsEnabled.value === 0;

/** Ours to clear: never another's upper pose e.g. psi's hands */
const isPhaserPose = (key: null | string) => key === phaserConfig.pose || key === phaserConfig.avoid;

/** Turns them not at all, at `rate` `0`, but is an aim: a move strafes */
const heldAim = { at: 0, rate: 0, untilRest: false };

/** Their right forearm, found once per model: by name it is a search of their whole skeleton */
function handOf(npc: Npc, arm: ArmEntry) {
  if (arm.hand?.of !== npc.group) {
    const bone = npc.group?.getObjectByName("rightforearm");
    arm.hand = bone === undefined ? null : { of: npc.group, bone };
  }
  return arm.hand?.bone ?? null;
}

/**
 * Radians to roll the gun back about the forearm, which is rolled a quarter turn in our pose alone: undone by
 * however much it is NOT, so the gun never turns about its barrel as the arm comes up or down
 */
function gunRoll(npc: Npc, hand: THREE.Object3D) {
  const { upper } = npc.anim;
  const { restRoll } = phaserConfig;
  // drawn in, by the blend instead
  if (upper.key === phaserConfig.avoid) return (1 - eased(upper.blend)) * restRoll;
  const twist = 2 * Math.atan2(hand.quaternion.y, hand.quaternion.w);
  return THREE.MathUtils.clamp(restRoll - Math.abs(deltaAngle(0, twist)), 0, restRoll);
}

/** Writes instance `i`'s four floats, with no array made for them */
function put(data: Float32Array, i: number, a: number, b: number, c: number, d: number) {
  const at = i * 4;
  data[at] = a;
  data[at + 1] = b;
  data[at + 2] = c;
  data[at + 3] = d;
}
const muzzle = new THREE.Vector3(...phaserConfig.beamFrom);
const tmpTip = new THREE.Vector3();
const tmpPart = new THREE.Vector3();
const tmpBody = new THREE.Vector3();
const tmpAlong = new THREE.Vector3();
const tmpAt = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpRoll = new THREE.Quaternion();
const tmpArmWant = new THREE.Vector3();
const tmpShoulder = new THREE.Vector3();
const tmpPast = new THREE.Vector3();
const tmpAcross = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);
