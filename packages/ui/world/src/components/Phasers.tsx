import { useStateRef } from "@npc-cli/util";
import { geomService } from "@npc-cli/util/geom-service";
import { deltaAngle } from "maath/misc";
import { useContext, useEffect } from "react";
import * as THREE from "three/webgpu";
import { npcDims } from "../const.both";
import { wallHeight } from "../const.env";
import { lieAim, upperFadeSecs } from "../const.npc";
import { aimToRay, alongAim } from "../service/aim-target";
import { eased } from "../service/fade";
import { createPhaserUniforms, type PhaserUniforms, phaserLook } from "../service/phaser.shader";
import {
  type ArmEntry,
  type ArmReach,
  type ArmShot,
  type ArmSight,
  acrossStop,
  armAimAt,
  armBearingOf,
  armEnds,
  bearingPast,
  byAvoid,
  distinctObstacles,
  facingOf,
  glideArmAt,
  gunLine,
  gunRoll,
  gunY,
  handOf,
  heldAim,
  hitBones,
  holdLineOf,
  isCastCurrent,
  isPhaserPose,
  leaving,
  levelOf,
  lockPoint,
  lower,
  meetObstacles,
  muzzle,
  muzzleAt,
  onLine,
  phaserConfig,
  segsApart,
  shotPast,
  shouldersOf,
  type Tilt,
  tipOf,
  toSeg,
} from "../service/phaser-arm";
import {
  advanceBeam,
  beamEnd,
  bodyPartPoint,
  createBeam,
  type FreeShot,
  isFreeShot,
  type Leg,
  legMeets,
  type NpcTarget,
  partOnRay,
  raysMeet,
  reflect,
  type StruckKind,
  targetPoint,
} from "../service/phaser-beam";
import { type BeamResources, beamNodes, createBeamResources, MAX_BEAM_SEGMENTS } from "../service/phaser-beam.shader";
import { type GunAttachment, gunAttachments, muzzleOf } from "../service/phaser-gun";
import {
  createGunResources,
  type GunResources,
  gunNodes,
  gunShaderConfig,
  MAX_PHASERS,
} from "../service/phaser-gun.shader";
import {
  createImpactResources,
  type ImpactResources,
  impactNodes,
  impactShaderConfig,
  impactSize,
  MAX_IMPACTS,
} from "../service/phaser-impact.shader";
import {
  attachmentBeams,
  beamRgb,
  beamSegments,
  beamStyles,
  checkLook,
  defaultLook,
  type PhaserLook,
  resolveLook,
  type SpreadRay,
} from "../service/phaser-look";
import type { AnimationClipKey } from "./NPCs";
import type { Npc } from "./npc";
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
      ...createPhaserUniforms(),
      gun: createGunResources(),
      beams: createBeamResources(),
      impacts: createImpactResources(),
      landed: [],
      arms: new Map(),
      looks: new Map(),
      stowed: new Set(),
      decide: null,
      pale: false,
      tickedSecs: w.gameTime.now(),

      aimAt(npcKey, at) {
        if (at !== null && hitBones.includes(at.part) === false) {
          throw Error(`${at.part}: expected one of ${hitBones.join(", ")}`);
        }
        const arm = at === null ? state.arms.get(npcKey) : state.ensure(npcKey);
        if (arm !== undefined)
          arm.aimAt = at === null ? null : { ...at, held: at.held === true, secs: w.gameTime.now() };
        w.r3f?.invalidate();
      },
      aimOf(npcKey) {
        const arm = state.arms.get(npcKey);
        const npc = w.n?.[npcKey];
        if (arm?.armed !== true || npc === undefined) return null;
        const [ax, az, x, z] = gunLine(npc, arm);
        // sat or lain, along the arm to where it points
        const [tx, tz] = arm.armAim?.at === arm.armAt ? [arm.armAt.x, arm.armAt.z] : [x, z];
        const { anim } = npc;
        const hand = anim.posture === "stand" ? null : handOf(npc, arm);
        hand?.updateWorldMatrix(true, false);
        /** The muzzle's height: stood or crouched as `gunY`, sat or lain the tip's */
        const y = hand === null ? gunY(npc) : hand.localToWorld(tmpTip.fromArray(phaserConfig.beamFrom)).y;
        const bearing = geomService.getThreeRotationY(tz - az, tx - ax);
        return { from: { x, y: z }, bearing, y, pitch: arm.pitch ?? 0 }; // undefined in an entry from before hmr
      },
      aimRay(npcKey, out) {
        const aim = state.aimOf(npcKey);
        return aim === null ? null : aimToRay(aim, out);
      },

      arm(npcKey, opts = {}) {
        if (w.npc.npcToDoable[npcKey] != null && w.n?.[npcKey]?.anim.posture === "stand") return; // sat or lain alone
        if (w.e.hasItem(npcKey, "phaser") === false) return; // nor without one
        if (w.shields?.isDead(npcKey) === true) {
          if (npcKey === w.player.key) w.hud?.say("phaser deactivated");
          return;
        }
        if (w.n?.[npcKey]?.anim.hurt != null) return; // nor in pain, or pacified
        const at = opts.at ?? null;
        if (at !== null && at !== npcKey && state.isDrawnIn(npcKey)) return; // no shot leaves `phaser_aim_avoid`
        const arm = state.ensure(npcKey);
        state.stowed.delete(npcKey); // drawn again
        arm.target =
          at === null || at === npcKey ? null : { npcKey: at, part: opts.part ?? null, local: opts.local ?? null };
        if (arm.target !== null) state.takeCharge(arm); // fired
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
      bearingFor(npcKey, at) {
        const npc = w.n[npcKey];
        if (npc === undefined) return null;
        const arm = state.arms.get(npcKey);
        return arm?.armed === true ? bearingPast(npc, at, arm.muzzleRight) : npc.anim.bearingOf(at);
      },
      cancelCharge(npcKey) {
        const arm = state.arms.get(npcKey);
        if (arm?.charge == null) return false;
        const now = w.gameTime.now();
        arm.cool = { since: now, from: levelOf(arm.charge, now) };
        arm.charge = null;
        w.r3f?.invalidate();
        return true;
      },
      charge(npcKey) {
        const arm = state.arms.get(npcKey);
        if (arm?.armed !== true || arm.charge != null || state.isCooling(npcKey) || state.isDrawnIn(npcKey))
          return false;
        arm.charge = { since: w.gameTime.now() };
        w.r3f?.invalidate();
        return true;
      },
      chargeOf(npcKey) {
        return levelOf(state.arms.get(npcKey)?.charge, w.gameTime.now());
      },
      async castAlong(npc, arm, shot) {
        shot.casting = true;
        const [end] = await state.endsAlong([npc.key]);
        shot.casting = false;
        if (arm.target !== shot) return; // fired again, or let go of
        if (end === null) return void (arm.target = null); // e.g. its muzzle off the map
        Object.assign(shot, {
          at: end.at,
          dist: end.dist,
          what: end.what,
          decorKey: end.decorKey,
          reflect: end.reflect,
        });
        void state.bounce(npc, arm, shot);
        w.r3f?.invalidate();
      },
      async bounce(npc, arm, shot) {
        const face = shot.reflect;
        if (face == null || shot.at === null) return;
        const at = shot.at;
        const from = tipOf(npc, arm, tmpTip) ?? npc.position;
        const way = { x: at.x - from.x, y: at.z - from.z };
        const [leg] = await state.castLegs(npc, [{ at: { x: at.x, y: at.z }, way, face }], at.y);
        if (leg == null || (arm.target !== shot && arm.struck !== shot)) return; // fired again, or let go of
        // whoever it meets first, its shooter too
        shot.legHit = legMeets([npc, ...w.npc.near.inReach(npc.key)], leg, at.y, hitBones);
        shot.leg = shot.legHit?.at ?? leg.end;
        if (arm.struck === shot) state.strikeLeg(npc, shot); // struck already
        w.r3f?.invalidate();
      },
      async castLegs(npc, starts, y) {
        const run = phaserConfig.alongMax;
        const segs = starts.map((start) => {
          if (start === null) return null;
          const way = reflect(start.way, start.face);
          // from just off the shield, so it leaves it
          const src = { x: start.at.x + way.x * 0.02, y: start.at.y + way.y * 0.02 };
          return { src, way, dst: { x: src.x + way.x * run, y: src.y + way.y * run } };
        });
        if (segs.every((seg) => seg === null)) return segs.map(() => null);
        const casts = await w.e
          .raycasts(segs, { offMap: true, key: `${npc.key}/bounce` })
          .catch(() => segs.map(() => null));
        return segs.map((seg, i) => {
          if (seg === null) return null;
          const hit = casts[i]?.hit ?? seg.dst;
          return { src: seg.src, way: seg.way, end: new THREE.Vector3(hit.x, y, hit.y) };
        });
      },

      async endsAlong(npcKeys) {
        const run = phaserConfig.alongMax;
        const aims = npcKeys.map((npcKey) => (w.n?.[npcKey] === undefined ? null : state.aimOf(npcKey)));
        const segs = aims.map((aim) => {
          if (aim === null) return null;
          const { from, bearing, y } = aim;
          return { src: from, dst: { x: from.x - Math.sin(bearing) * run, y: from.y - Math.cos(bearing) * run }, y };
        });
        const results = await w.e.raycasts(segs, { offMap: true, key: "along" }).catch(() => segs.map(() => null));
        /** Where a shot at no one along `aim` stops, given its cast */
        const endOf = (npcKey: string, aim: import("../service/aim-target").Aim, result: JshCli.RaycastResult) => {
          const { from, y, pitch } = aim;
          const slope = Math.tan(pitch);
          /** Its height `d` metres along the ground */
          const heightAt = (d: number) => y + d * slope;
          const [dx, dz] = [-Math.sin(aim.bearing), -Math.cos(aim.bearing)];
          let dist = result.hit === null ? run : Math.hypot(result.hit.x - from.x, result.hit.y - from.y);
          let what: StruckKind = result.hit === null ? "nothing" : result.hitDoor !== null ? "door" : "wall";
          // tilted, the floor or the ceiling first
          const flat = pitch === 0 ? Infinity : (pitch < 0 ? -y : wallHeight - y) / slope;
          if (flat < dist) [dist, what] = [flat, pitch < 0 ? "floor" : "ceiling"];
          let decorKey: null | string = null;
          // nearest first: in at its side, else down through its top or up through its underside
          const solids = [...result.obstacles, ...(result.decor ?? [])].sort((a, b) => a.dist - b.dist);
          for (const solid of solids) {
            const { dist: d0, leave, top, bottom } = solid;
            if (d0 >= dist) break;
            const [h0, h1] = [heightAt(d0), heightAt(Math.min(leave, dist))];
            if (Math.max(h0, h1) < bottom || Math.min(h0, h1) > top) continue;
            const d = h0 >= bottom && h0 <= top ? d0 : ((h0 > top ? top : bottom) - y) / slope;
            decorKey = "decorKey" in solid ? solid.decorKey : null;
            [dist, what] = [d, decorKey === null ? "obstacle" : "decor"];
            break;
          }
          const at = new THREE.Vector3(from.x + dx * dist, heightAt(dist), from.y + dz * dist);
          const stopped = state.shieldStop(npcKey, result.shields, from, y, at);
          if (stopped !== null) {
            at.copy(stopped.at);
            [what, decorKey] = ["shield", null];
          }
          const reflect = stopped?.reflect ?? null;
          return { at, what, decorKey, dist: Math.hypot(at.x - from.x, at.z - from.y), rooms: result.rooms, reflect };
        };
        return results.map((result, i) => {
          const aim = aims[i];
          return result === null || aim === null ? null : endOf(npcKeys[i], aim, result);
        });
      },
      disarm(...npcKeys) {
        const lowered = npcKeys.filter((npcKey) => {
          const arm = state.arms.get(npcKey);
          return arm !== undefined && lower(arm);
        });
        state.sync();
        lowered.length > 0 && w.events.next({ key: "phasers", armed: false, npcKeys: lowered });
      },
      ensure(npcKey) {
        let arm = state.arms.get(npcKey);
        if (arm === undefined) {
          arm = {
            armAim: null,
            armAt: new THREE.Vector3(),
            pitch: 0,
            tilt: 0,
            aimAt: null,
            pitchAt: null,
            tiltAt: new THREE.Vector3(),
            armed: false,
            armHit: false,
            beam: createBeam(),
            cast: null,
            spread: null,
            spreadHit: null,
            met: new Map(),
            casting: false,
            castSecs: -Infinity,
            charge: null,
            cool: null,
            fireCharge: 0,
            firedSecs: null,
            gliding: false,
            hand: null,
            hitAt: null,
            holdUntil: 0,
            idleBefore: null,
            key: npcKey,
            look: { ...defaultLook },
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
            steady: false,
            struck: null,
            target: null,
            toward: null,
          };
          state.arms.set(npcKey, arm);
        }
        return arm;
      },
      fireAlong(npcKey, end) {
        if (state.isDrawnIn(npcKey)) return false; // no shot leaves `phaser_aim_avoid`
        if (state.isArmed(npcKey) === false) state.arm(npcKey);
        const arm = state.arms.get(npcKey);
        if (arm?.armed !== true) return false;
        const shot: FreeShot = {
          npcKey: null,
          part: null,
          at: end?.at.clone() ?? null,
          dist: end?.dist ?? null,
          what: end?.what ?? null,
          decorKey: end?.decorKey ?? null,
          casting: false,
          reflect: end?.reflect ?? null,
        };
        arm.target = shot;
        const npc = w.n[npcKey];
        if (end !== undefined && npc !== undefined) void state.bounce(npc, arm, shot);
        arm.hitAt = null;
        arm.met = new Map();
        state.takeCharge(arm);
        state.sync();
        w.events.next({ key: "phaser-fired", by: npcKey, charge: arm.fireCharge });
        return true;
      },
      glowOf(arm, now) {
        if (arm.charge != null) return levelOf(arm.charge, now);
        if (arm.cool == null) return 0;
        const t = (now - arm.cool.since) / phaserConfig.coolSecs;
        if (t >= 1) {
          arm.cool = null;
          return 0;
        }
        // it sputters as it drains
        return arm.cool.from * (1 - t) * (0.65 + 0.35 * Math.sin(t * phaserConfig.sputterHz * 2 * Math.PI));
      },
      gunHeight(npcKey) {
        const npc = w.n[npcKey];
        return npc === undefined ? -phaserConfig.gunBelowHead : gunY(npc);
      },
      freeEndOf(npc, arm, shot, out) {
        if (shot.at === null || shot.dist === null) return null;
        const aim = state.aimOf(npc.key);
        if (aim === null) return arm.hitAt ?? shot.at; // lowered
        // the dot's own length, else the shot's cast
        return alongAim(aim, w.npcFocus?.phasers.get(npc.key)?.end?.dist ?? shot.dist, out);
      },
      hold(npcKey) {
        if (state.arms.has(npcKey) || w.n?.[npcKey] === undefined || state.holds(npcKey) === false) return;
        state.ensure(npcKey).beam.gun.presence = 1; // there at once: taken up, stood up, or arrived
        w.r3f?.invalidate();
      },
      holds(npcKey) {
        return (
          w.e.hasItem(npcKey, "phaser") === true &&
          w.npc.npcToDoable[npcKey] == null &&
          state.stowed.has(npcKey) === false
        );
      },

      isArmed(npcKey) {
        return state.arms.get(npcKey)?.armed === true;
      },
      isCharging(npcKey) {
        return state.arms.get(npcKey)?.charge != null;
      },
      isSteadied(npcKey) {
        const arm = state.arms.get(npcKey);
        return arm?.armed === true && arm.steady === true;
      },
      steady(npcKey, on) {
        const arm = state.arms.get(npcKey);
        // the cursor a crosshair whilst aiming, written direct: a render of the view would cost more
        if (npcKey === w.player.key) w.view.canvas?.toggleAttribute("data-aiming", on && arm?.armed === true);
        if (arm === undefined || arm.steady === on) return;
        arm.steady = on;
        w.r3f?.invalidate();
      },
      stow(...npcKeys) {
        for (const npcKey of npcKeys) {
          state.stowed.add(npcKey);
          const anim = w.n?.[npcKey]?.anim;
          anim?.setNearWall(anim.nearWall, anim.wallRoom); // an arm a wall drew in lets go
        }
        state.disarm(...npcKeys); // its `sync` fades the gun, even if already lowered
      },
      isCooling(npcKey) {
        const cool = state.arms.get(npcKey)?.cool;
        return cool != null && w.gameTime.now() - cool.since < phaserConfig.coolSecs;
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
          const local = isFreeShot(target) ? null : target?.local;
          const opts = {
            at: target?.npcKey,
            part: target?.part,
            local,
            toward: toward ?? undefined,
            once: lowerAt !== null,
          };
          state.arm(npcKey, opts);
          if (pointAt !== null) state.pointAt(npcKey, pointAt);
        };
      },
      markDirty() {
        for (const arm of state.arms.values()) arm.cast = null;
        w.npcFocus?.recast();
      },
      pointAt(npcKey, at) {
        const arm = state.arms.get(npcKey);
        if (arm?.armed !== true) return;
        arm.pointAt = Object.assign(arm.pointAt ?? { x: 0, y: 0 }, { x: at.x, y: at.y });
        arm.toward = null;
        w.r3f?.invalidate();
      },
      lookOf(npcKey) {
        return resolveLook(w.shields?.phaserOf(npcKey)?.meta, state.looks.get(npcKey), { ...defaultLook });
      },
      setLook(npcKey, look) {
        if (look !== null) checkLook(look);
        if (look === null) state.looks.delete(npcKey);
        else state.looks.set(npcKey, { ...state.looks.get(npcKey), ...look });
        const arm = state.arms.get(npcKey);
        if (arm !== undefined) arm.cast = null; // recast, e.g. for a shotgun's spread
        w.hud?.update(); // its icon shows the attachment
        w.r3f?.invalidate();
      },
      syncTheme() {
        const theme = w.getTheme();
        // light cannot be added to a pale deck, so there the beam is laid over it, in a deeper ink
        const pale = theme.floor.deck === "light";
        state.pale = pale; // each beam's colour follows, see `beamRgb`
        state.gun.gunColor.value.set(pale ? gunShaderConfig.paleGunColor : gunShaderConfig.gunColor);
        state.gain.value = pale ? 1 : theme.npcs.fxStrength;
        state.faint.value = pale ? phaserLook.paleFaint : phaserLook.faint;
        const blending = pale ? THREE.NormalBlending : THREE.AdditiveBlending;
        for (const mat of [...state.beams.mats, state.impacts.mat]) {
          if (mat.blending === blending) continue;
          mat.blending = blending;
          mat.needsUpdate = true;
        }
        w.r3f?.invalidate();
      },
      takeCharge(arm) {
        arm.fireCharge = levelOf(arm.charge, w.gameTime.now());
        arm.charge = null;
      },
      tilt(npcKey, tilt) {
        Object.assign(state.ensure(npcKey), { tilt, aimAt: null, pitchAt: null });
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

        let [guns, beams] = [0, 0];
        for (const [srcKey, arm] of state.arms) {
          const npc = w.n[srcKey];
          if (npc === undefined) {
            state.arms.delete(srcKey);
            continue;
          }
          state.wield(npc, arm, delta);
          const { beam } = arm;
          advanceBeam(beam, step, w.n, instant);
          // no object made, most ticks
          if (beam.locked.presence === 0) arm.struck = arm.hitAt = arm.shot = arm.spreadHit = null;
          if (beam.to !== null && beam.to.npcKey !== null && beam.locked.target === 1 && arm.shot?.to !== beam.to) {
            state.shoot(npc, arm, beam.to);
          }
          // a shot passing them waits, unseen, until it knows whom it meets beyond, and each ghost is one
          if (arm.shot?.to === beam.to && shotWaits(w, arm.shot)) {
            beam.shown.presence = Math.min(beam.shown.presence, 1e-3);
            beam.locked.presence = Math.min(beam.locked.presence, 1e-3);
          }
          if (beam.locked.presence === 1 && beam.to !== arm.struck) state.strike(npc, arm);
          const hidden = beam.shown.presence === 0 && beam.gun.presence === 0;
          if (arm.armed === false && hidden && state.holds(srcKey) === false) {
            state.arms.delete(srcKey); // no longer held, its pose, stance and aim already let go of
            continue;
          }
          if (hidden || guns === MAX_PHASERS) continue;
          const dst = beam.to === null || beam.to.npcKey === null ? undefined : w.n[beam.to.npcKey];
          // out of sight at both ends nothing of it is drawn, so nothing is worked out: `wield` above still ran
          if (unseen(w, npc) && (dst === undefined || unseen(w, dst))) continue;

          // segments only whilst shown: its end is still worked out, as `beamEnd` glides it
          const room = beam.shown.presence > 0 ? MAX_BEAM_SEGMENTS - beams : 0;
          const drawn = state.draw(npc, arm, dst, guns, beams, room);
          if (drawn === -1) continue;
          guns++;
          beams += drawn;
        }

        upload(state.gun, guns);
        upload(state.beams, beams);

        if (state.landed.length > 0) {
          const kept = state.landed.filter((l) => now - l.secs < impactShaderConfig.secs);
          if (kept.length < state.landed.length) {
            state.landed = kept;
            state.writeImpacts();
          }
          w.r3f?.invalidate(); // one more frame once the last is gone
        }
      },
      draw(npc, arm, dst, i, j, room) {
        const tip = tipOf(npc, arm, tmpTip);
        const hand = arm.hand?.bone;
        if (tip === null || hand === undefined) return -1;
        const { beam } = arm;
        const ry = facingOf(npc); // with the sat turn, which `bearingPast` adds to: else each feeds the other
        arm.muzzleRight = (tip.x - npc.position.x) * Math.cos(ry) - (tip.z - npc.position.z) * Math.sin(ry);
        const along = tmpAlong.set(0, -1, 0).transformDirection(hand.matrixWorld); // the forearm, towards the hand
        /** Their phaser's own, looked up once: the frequencies it knows, and those it is dead to */
        const item = w.shields?.phaserOf(npc.key)?.meta;
        const free = isFreeShot(beam.to) ? beam.to : null;
        const part =
          free !== null
            ? state.freeEndOf(npc, arm, free, tmpFree)
            : dst === undefined
              ? null
              : (arm.hitAt ?? shotPast(arm, tip, tmpPart) ?? targetPoint(dst, beam.to, tmpPart));
        /** Where a shield between them stops it: of those their last cast passed. A shot at no one's cast settled it */
        const stopped =
          part === null || free !== null
            ? null
            : (w.shields?.stop(
                arm.sight.shields,
                tmpBody.set(npc.position.x, tip.y, npc.position.z),
                tip,
                part,
                item?.freqs,
              ) ?? null);
        const blocked = part === null || free !== null ? null : acrossStop(arm, tip, part, tmpAcross);
        const stop =
          blocked !== null && (stopped === null || tip.distanceTo(blocked) < tip.distanceTo(stopped))
            ? blocked
            : stopped;
        const end = beamEnd(beam, tip, along, part, stop);
        const shown = eased(beam.shown.presence);
        const locked = eased(beam.locked.presence);
        // struck where the beam IS, not where it is headed: it glides there
        if ((stopped !== null && stop === stopped) || free?.what === "shield") w.shields.strike(end, shown * locked);
        // into theirs, so nothing is made each tick
        const look = resolveLook(item, state.looks.get(npc.key), (arm.look ??= { ...defaultLook })); // undefined from before hmr
        const rgb = beamRgb(look.color, state.pale);
        let drawn = 0;
        if (room > 0) {
          const { roomSlot, npcLit } = dst ?? npc;
          const { beams } = state;
          // a rotator fires bolts, unless given another style
          const style = beamStyles.indexOf(
            look.attachment === "rotator" && look.style === "plain" ? "bolts" : look.style,
          );
          const from =
            look.attachment === null ? tip : hand.localToWorld(tmpMuzzle.fromArray(muzzleOf(look.attachment)));
          const fired = arm.fireCharge ?? 0; // undefined from before hmr
          const legs = beamSegments(look, from, end, arm.spreadHit ?? arm.spread ?? null, free?.leg);
          for (const seg of legs) {
            if (drawn === room) break;
            const k = j + drawn;
            put(beams.srcData, k, seg.from.x, seg.from.y, seg.from.z, shown);
            put(beams.dstData, k, seg.to.x, seg.to.y, seg.to.z, locked);
            put(beams.roomData, k, npc.roomSlot.value, roomSlot.value, npc.npcLit.value, npcLit.value);
            // seeded per gun, so no two phasers' lightning matches
            put(beams.lookData, k, style, 16 * i + drawn++, fired, seg.ball ? 1 : 0);
            put(beams.colorData, k, rgb.r, rgb.g, rgb.b, seg.width);
          }
        }

        hand.matrixWorld.decompose(tmpAt, tmpQuat, tmpScale);
        const roll = gunRoll(npc, hand);
        if (roll > 0) tmpQuat.multiply(tmpRoll.set(0, Math.sin(roll / 2), 0, Math.cos(roll / 2))); // about the forearm, its `y`
        const present = eased(beam.gun.presence);
        // scaled about the forearm's origin, their elbow: slid down it, so it shrinks into the hand instead
        tmpAt.addScaledVector(along, phaserConfig.grip * tmpScale.x * (1 - present));
        const now = w.gameTime.now();
        const glow = state.glowOf(arm, now);
        if (glow > 0) {
          // charging it shakes, as it does draining: high sines of game time, so no frame rate shows
          const { shakeM, shakeRad, shakeHz } = phaserConfig;
          const t = now * shakeHz * 2 * Math.PI;
          tmpAt.x += glow * shakeM * Math.sin(t);
          tmpAt.y += glow * shakeM * Math.sin(1.37 * t + 1);
          tmpAt.z += glow * shakeM * Math.sin(1.71 * t + 2);
          const r = glow * shakeRad * Math.sin(1.53 * t + 3);
          tmpQuat.multiply(tmpShake.set(Math.sin(r / 2), 0, 0, Math.cos(r / 2)));
        }
        const { gun } = state;
        put(gun.tintData, i, rgb.r, rgb.g, rgb.b, glow);
        gun.roomData[3 * i] = npc.roomSlot.value;
        gun.roomData[3 * i + 1] = npc.npcLit.value;
        gun.roomData[3 * i + 2] = look.attachment === null ? 0 : gunAttachments.indexOf(look.attachment) + 1;
        const sign = (item?.dead?.length ?? 0) > 0 ? -1 : 1; // negative: dead, see `gunNodes`
        put(gun.gunData, i, tmpAt.x, tmpAt.y, tmpAt.z, tmpScale.x * present * sign);
        const flip = arm.armed === tmpQuat.w > 0 ? 1 : -1; // so `w > 0` says armed, see `gunNodes`
        put(gun.quatData, i, tmpQuat.x * flip, tmpQuat.y * flip, tmpQuat.z * flip, tmpQuat.w * flip);
        return drawn;
      },
      strike(npc, arm) {
        const to = (arm.struck = arm.beam.to);
        if (isFreeShot(to)) {
          if (to.at !== null && to.what !== null) {
            const at = state.freeEndOf(npc, arm, to, tmpFree) ?? to.at;
            const { x, y, z } = at;
            w.events.next({
              key: "phaser-struck",
              by: npc.key,
              at: { x, y, z },
              what: to.what,
              decorKey: to.decorKey ?? null,
            });
            arm.hitAt = (arm.hitAt ?? new THREE.Vector3()).copy(at); // fades where it ended
            const tip = tipOf(npc, arm, tmpTip);
            state.impact(npc, at, tip ?? npc.position, null);
            // its own line met no one: an attachment's other rays may, else what it reflects on to
            if (tip !== null) state.spreadOn(npc, arm, tip, at);
            state.strikeLeg(npc, to);
          }
          arm.target = arm.firedSecs = null;
          return void w.hud?.update();
        }
        const dst = to === null ? undefined : w.n[to.npcKey];
        if (to === null || dst === undefined) return;
        const part = targetPoint(dst, to, tmpPart);
        const from = tmpBody.set(npc.position.x, part.y, npc.position.z);
        const end = shotPast(arm, from, tmpPast) ?? part;
        if (w.shields?.stop(arm.sight.shields, from, from, end, w.shields.phaserOf(npc.key)?.meta?.freqs) != null)
          return;
        const tip = tipOf(npc, arm, tmpTip);
        // as drawn: it lands on the wall or door in the way
        const across = tip === null ? null : acrossStop(arm, tip, end, tmpAcross);
        if (tip !== null && across !== null) return void state.impact(npc, across, tip, null);
        const shot = arm.shot?.to === to ? arm.shot : null;
        const outcome = shot?.outcome ?? "hit";
        /** A ghost passes it on. Anyone else is where the burst ends, rather than following them as they writhe */
        const landOn = (on: Npc, target: NpcTarget, outcome: JshCli.ShotOutcome, at: THREE.Vector3) => {
          state.landRay(npc, on, target.part, outcome, at, tip ?? from);
          if (outcome !== "ghost") arm.hitAt = (arm.hitAt ?? new THREE.Vector3()).copy(at);
        };
        // one passing them, unless a ghost, has no outcome
        if (outcome === "ghost" || end === part) landOn(dst, to, outcome, part);
        if (outcome !== "ghost" && end === part && tip !== null) state.spreadOn(npc, arm, tip, part);
        // on through whoever it meets beyond, to the one it lands on
        for (const next of shot?.beyond ?? []) {
          const on = w.n[next.npcKey];
          if (on !== undefined) landOn(on, next, next.outcome, targetPoint(on, next, tmpPart));
        }
        arm.target = arm.firedSecs = null;
        w.hud?.update();
      },
      strikeLeg(npc, shot) {
        const { leg } = shot;
        if (leg == null || shot.at === null) return;
        const met = shot.legHit ?? null;
        if (met === null) state.impact(npc, leg, shot.at, null);
        else state.landRay(npc, met.on, met.part, state.outcomeFor(npc, met.on, "bounce"), leg, shot.at);
      },

      spreadOn(npc, arm, tip, end) {
        const attachment = arm.look?.attachment ?? null;
        if (attachment !== "shotgun" && attachment !== "caliber") return;
        // a shotgun's rays go to their own walls or shields. A caliber's share the shot's, a little past to meet whom it struck
        const shot = Math.hypot(end.x - tip.x, end.z - tip.z) + 0.05;
        const wall = (i: number) =>
          attachment === "shotgun" ? (arm.spread?.[i]?.dist ?? Number.POSITIVE_INFINITY) : shot;
        const others = w.npc.near.inReach(npc.key).filter((o) => o.key !== npc.key);
        const met = raysMeet(attachment, tip, end, others, hitBones, wall).map((m) => m && { ...m, from: tip });
        // a ray meeting no one bounces on off a reflecting shield: whom its leg meets
        const legs = attachment === "shotgun" ? (arm.spread ?? []).map((ray) => ray.leg) : [];
        const all = [npc, ...others]; // a bounce may meet its shooter too
        const legMet = legs.map((leg, i) => {
          if (leg === null || met[i] !== null) return null;
          const m = legMeets(all, leg, tip.y, hitBones);
          return m && { ...m, from: new THREE.Vector3(leg.src.x, tip.y, leg.src.y) };
        });
        // nearest first, so each npc takes the shot from the nearest ray, then bounce, meeting them
        const byDist = (ms: typeof met) => ms.filter((m) => m !== null).sort((a, b) => a.dist - b.dist);
        for (const [ms, ray] of [
          [met, "side"],
          [legMet, "bounce"],
        ] as const)
          for (const m of byDist(ms)) state.landRay(npc, m.on, m.part, state.outcomeFor(npc, m.on, ray), m.at, m.from);
        // each ending on whom it meets, bar a ghost: a bounce drawn only after it met no one
        const solid = (m: null | { on: Npc }) => m !== null && arm.met?.get(m.on.key)?.outcome !== "ghost";
        arm.spreadHit = met.map((m, i) => {
          const leg = legs[i] ?? null;
          const legMeet = legMet[i] ?? null;
          return {
            dist: solid(m) ? (m?.dist ?? 0) : attachment === "shotgun" ? wall(i) : Number.POSITIVE_INFINITY,
            legEnd: leg === null || solid(m) ? null : solid(legMeet) ? (legMeet?.at ?? leg.end) : leg.end,
          };
        });
      },

      landRay(npc, on, part, outcome, at, from) {
        const arm = state.arms.get(npc.key);
        const hits = arm?.met?.get(on.key)?.landed !== true; // once a shot each
        arm?.met?.set(on.key, { outcome, landed: true });
        if (hits) {
          if (outcome === "ghost") w.npcGhost?.struck(on);
          state.land(npc, on, part, outcome, at, from);
        }
        if (outcome === "ghost") return; // it passes through
        state.impact(npc, at, from, on);
        if (outcome === "armour") w.npcArmour?.flash(on, part, at, from);
      },
      shieldStop(npcKey, shields, from, y, to) {
        const start = tmpBody.set(from.x, y, from.y);
        const at = w.shields?.stop(shields, start, start, to, w.shields.phaserOf(npcKey)?.meta?.freqs) ?? null;
        if (at === null) return null;
        const face = w.shields.stoppedBy;
        return { at, reflect: face?.reflect === true ? { a: face.a, b: face.b } : null };
      },
      impact(npc, at, from, on) {
        const arm = state.arms.get(npc.key);
        const rgb = beamRgb(arm?.look?.color ?? defaultLook.color, state.pale);
        const charged = 1 + (arm?.fireCharge ?? 0) * impactSize.chargeWiden;
        const { roomSlot, npcLit } = on ?? npc;
        state.landed.push({
          at: at.clone(),
          way: new THREE.Vector3().subVectors(at, from).normalize(),
          size: (on === null ? 1 : impactSize.onNpc) * charged,
          rgb: [rgb.r, rgb.g, rgb.b],
          secs: w.gameTime.now(),
          room: roomSlot.value,
          lit: npcLit.value,
        });
        if (state.landed.length > MAX_IMPACTS) state.landed.shift();
        state.writeImpacts();
      },
      writeImpacts() {
        const { impacts } = state;
        state.landed.forEach(({ at, way, size, rgb, secs, room, lit }, i) => {
          put(impacts.atData, i, at.x, at.y, at.z, secs);
          put(impacts.dirData, i, way.x, way.y, way.z, size);
          impacts.lookData.set(rgb, 3 * i);
          impacts.roomData[2 * i] = room;
          impacts.roomData[2 * i + 1] = lit;
        });
        upload(impacts, state.landed.length);
        w.r3f?.invalidate();
      },
      land(npc, dst, part, outcome, at, from) {
        const hits = outcome === "hit" || outcome === "down" || outcome === "kill";
        if (hits) void w.e.takeHit(dst.key, part, { at, from, outcome });
        w.events.next({ key: "npc-shot", by: npc.key, npcKey: dst.key, part, outcome });
        if (hits === false && npc.key === w.player.key) w.hud?.say(outcome);
        // lowered here, not by `disarm`, whose `sync` would tick again mid-tick
        const theirs = state.arms.get(dst.key);
        const down = dst.anim.hurt !== null || dst.anim.staggering === true;
        if (hits && down && theirs !== undefined && lower(theirs))
          w.events.next({ key: "phasers", armed: false, npcKeys: [dst.key] });
      },
      meetPart(npc, arm, dst, to) {
        const tip = tipOf(npc, arm, tmpTip);
        if (tip === null) return true; // no muzzle to tell from
        tmpShotRay.set(tip, tmpShotDir.subVectors(targetPoint(dst, to, tmpPart), tip).normalize());
        const met = partOnRay(dst, tmpShotRay, hitBones);
        if (met === null) return false;
        // the part it meets first, e.g. a forearm in the way
        Object.assign(to, { part: met.part, local: met.local.clone() });
        return true;
      },
      outcomeFor(npc, on, ray) {
        const arm = state.arms.get(npc.key);
        const known = arm?.met?.get(on.key)?.outcome;
        if (known !== undefined) return known;
        let decided: undefined | JshCli.ShotOutcome;
        try {
          decided = state.decide?.({ by: npc.key, npcKey: on.key, ray, attachment: arm?.look?.attachment ?? null });
        } catch (e) {
          console.warn("w.phasers.decide threw", e);
        }
        const outcome = decided ?? w.debug?.forceShot ?? "hit";
        arm?.met?.set(on.key, { outcome, landed: false });
        return outcome;
      },
      passOn(npc, arm, shot) {
        const { through, past } = shot;
        const dst = w.n[shot.to.npcKey];
        shot.beyond = [];
        if (through === null || dst === undefined) return;
        const tip = tipOf(npc, arm, tmpTip) ?? tmpTip.copy(npc.position);
        const ray = tmpShotRay.set(tip, tmpShotDir.subVectors(through, tip).normalize());
        /** Metres on the ground to the wall beyond */
        const reach = past === null ? phaserConfig.passMax : Math.hypot(past.x - tip.x, past.y - tip.z);
        // those within reach of whom it passes that its line meets short of the wall, in turn
        const met = w.npc.near
          .inReach(dst.key)
          .flatMap((on) => {
            const hit = on.key === npc.key ? null : partOnRay(on, ray, hitBones); // shared, so copied
            if (hit === null || Math.hypot(hit.point.x - tip.x, hit.point.z - tip.z) > reach) return [];
            return [{ on, part: hit.part, local: hit.local.clone(), x: hit.point.x, y: hit.point.z, dist: hit.dist }];
          })
          .sort((a, b) => a.dist - b.dist);
        for (const { on, part, local, x, y } of met) {
          // a ghost already passes it on too
          const outcome = w.npcGhost?.ghosts.has(on.key) === true ? "ghost" : state.outcomeFor(npc, on, "beyond");
          shot.beyond.push({ npcKey: on.key, part, local, outcome });
          if (outcome !== "ghost") {
            shot.past = { x, y }; // it ends on them
            break;
          }
          w.npcGhost?.ghost(on); // one, or kept one, as it passes through
        }
        w.r3f?.invalidate();
      },
      shoot(npc, arm, to) {
        const dst = w.n[to.npcKey];
        arm.met = new Map();
        const outcome = dst === undefined ? (w.debug?.forceShot ?? "hit") : state.outcomeFor(npc, dst, "own");
        const shot: ArmShot = { to, outcome, through: null, past: null, beyond: null };
        arm.shot = shot;
        w.events.next({ key: "phaser-fired", by: npc.key, charge: arm.fireCharge });
        if (dst === undefined) return;
        /** Aimed at a point, the line from the muzzle through it meets no part of them: it passes there */
        const clear = to.local != null && state.meetPart(npc, arm, dst, to) === false;
        // a ghost's passes through them, as one aimed beside them passes
        const ghosted = clear === false && shot.outcome === "ghost";
        if (ghosted === true) w.npcGhost?.ghost(dst);
        if (clear === false && ghosted === false) return;
        const through = targetPoint(dst, to, new THREE.Vector3());
        shot.through = through;
        const length = Math.hypot(through.x - npc.position.x, through.z - npc.position.z) || 1;
        const dir = { x: (through.x - npc.position.x) / length, y: (through.z - npc.position.z) / length };
        void wallBeyond(w, dst.point, dir).then((past) => {
          shot.past = past;
          state.passOn(npc, arm, shot);
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
          w.events.next({ key: "phasers", armed: false, npcKeys: [npc.key] });
        }
        // a hand to steady it, once held a moment: a tap fires before it gets there
        const steadied = state.isSteadied(npc.key);
        npc.anim.support.on = arm.armed === true && steadied;
        if (steadied && arm.armed === true && w.e.isPsiRaised(npc.key)) {
          w.e.setPsi(false, npc.key); // the left hand leaves their temple for the gun
          w.hud?.update();
        }
        const onKey = arm.target?.npcKey ?? arm.toward;
        /** Whom they are on, else pointing at */
        const on = onKey === null ? undefined : w.n[onKey];
        const inReach = state.wieldReach(npc, arm, on);
        const { armed } = arm;
        const target =
          armed === true && arm.target !== null && arm.target.npcKey !== null ? w.n[arm.target.npcKey] : undefined;
        /** A shot at no one, along their aim */
        const free = armed === true && isFreeShot(arm.target) ? arm.target : null;
        state.recast(npc, arm, target, secs);
        const { avoid, swingHit } = state.wieldBlock(npc, arm, target, secs);
        if (avoid === true && state.cancelCharge(npc.key) && npc.key === w.player.key) {
          w.hud?.fireHint?.update(); // drawn in, it is called off: the fire hint stops pulsing
          w.hud?.say("phaser blocked");
        }
        state.wieldStance(npc, arm, state.wieldPose(npc, arm, avoid, swingHit));
        const heldAt = state.wieldFacing(npc, arm, target, free);
        state.wieldPitch(npc, arm, heldAt, delta, secs);
        state.wieldAim(npc, arm, on, inReach, delta);
        state.wieldBeam(npc, arm, target, free, inReach, avoid, secs);
      },
      wieldAim(npc, arm, on, inReach, delta) {
        const { anim } = npc;
        const { armed } = arm;
        const sat = anim.posture === "sit";
        const lain = anim.posture === "lie";
        arm.gliding = false;
        // lowered and down, its aim and held line let go of: it follows the beam, as a raise starts from
        if (
          armed === false &&
          isPhaserPose(anim.upper.key) === false &&
          (arm.hold?.ramp ?? 0) === 0 &&
          anim.upper.aim !== arm.armAim
        ) {
          if (arm.armAim !== null) arm.armAim.at = arm.beam.at;
          return;
        }
        // the arm's aim
        const { beam } = arm;
        arm.armAim ??= { at: beam.at, from: muzzle, weight: 0 };
        /** Stood and tilted with no beam, along the pitched aim */
        const tilted = arm.pitch !== 0 && beam.shown.presence === 0 ? state.aimRay(npc.key, tmpAimRay) : null;
        /** Raised, or still coming down: lowered at once, a pose drawn stood would swing the arm up */
        const aiming = armed === true || isPhaserPose(anim.upper.key);
        if (aiming === true && (sat === true || lain === true)) {
          // sat or lain the arm points as it comes up or down, swung far from the pose, which was drawn stood
          const at = glideArmAt(npc, arm, armAimAt(npc, arm, on, inReach, tmpArmWant), delta);
          // drawn in, it gives way to the pose as that swaps in, and takes over again as it swaps back
          const { key, swap } = anim.upper;
          const s = swap * swap * (3 - 2 * swap);
          Object.assign(arm.armAim, { at, weight: key === phaserConfig.avoid ? 1 - s : s, maxRad: Math.PI });
        } else if (tilted !== null) {
          // tilted, along its pitched aim, as far as tilted: level, the pose's own
          const at = tilted.at(phaserConfig.aimAhead, (arm.tiltAt ??= new THREE.Vector3()));
          const weight = Math.min(1, Math.abs(arm.pitch) / phaserConfig.pitchFullRad);
          Object.assign(arm.armAim, { at, weight, maxRad: undefined });
        } else {
          // the arm follows the beam
          Object.assign(arm.armAim, { at: beam.at, weight: eased(beam.shown.presence), maxRad: undefined });
        }
        arm.armAim.head = sat === true ? 0 : undefined; // sat, their turn has the head on them already
        // stood, the muzzle held on the aim's line, as the red dot is
        const stood = sat === false && lain === false;
        const holding = armed === true && stood && anim.upper.key !== phaserConfig.avoid; // not drawn in
        const hold = (arm.hold ??= { line: new THREE.Ray(), ramp: 0, weight: 0 });
        /** Drawn in by a wall, it lets go as quickly as the pose swaps in */
        const rampSecs = holding === false && arm.armHit === true ? phaserConfig.wallDrawInSecs : upperFadeSecs;
        hold.ramp = THREE.MathUtils.clamp(hold.ramp + (holding ? delta : -delta) / rampSecs, 0, 1);
        hold.weight = eased(hold.ramp);
        if (hold.weight > 0 && stood) holdLineOf(npc, arm, hold.line);
        arm.armAim.hold = hold.weight > 0 && stood ? hold : undefined;
        if (anim.upper.aim === null || anim.upper.aim === arm.armAim) anim.upper.aim = aiming ? arm.armAim : null;
      },
      wieldBeam(npc, arm, target, free, inReach, avoid, secs) {
        const { anim } = npc;
        const { armed, beam } = arm;
        // in hand whilst they carry it and stand, raised or lowered — or still armed, having just lost it
        beam.gun.target = armed === true || state.holds(npc.key) ? 1 : 0;
        // gone at once between the two halves of a teleport, and as they sit or lie, unless raised: rested lain, it stays in hand
        const seated = w.npc.npcToDoable[npc.key] != null && armed === false;
        if (leaving(npc)) beam.gun.target = beam.gun.presence = 0;
        else if (seated) {
          // lowered sat, it shrinks into the hand only as the arm comes back down
          const lowering = isPhaserPose(anim.upper.key) ? anim.upper.blend / phaserConfig.handBlend : 0;
          beam.gun.target = lowering > 0 ? 1 : 0;
          beam.gun.presence = Math.min(beam.gun.presence, lowering);
        } else if (beam.gun.target === 1 && beam.gun.presence === 0) beam.gun.presence = 1; // e.g. armed throughout
        const locking = (target !== undefined && arm.sight.inSight === true && inReach) || free?.at != null;
        /** The arm is all the way up: no beam on its way there, nor any left as it comes down */
        const raised = armed === true && anim.upper.key === phaserConfig.pose && anim.upper.blend === 1;
        // a shot at no one looks along their aim once raised, so it fires where they then face
        if (free !== null && free.at === null && free.casting === false && raised === true && avoid === false) {
          void state.castAlong(npc, arm, free);
        }
        /** Raised and on target: else a shot lands unseen, or off the barrel, the lock being quicker than the arm */
        const ready = locking && raised && onLine(npc, arm, target);
        // the beam waits too, or the arm, which follows it, swings round ahead of their turn
        beam.shown.target = ready && avoid === false ? 1 : 0;
        if (armed === false) beam.shown.presence = beam.locked.presence = 0;
        if (avoid === false) beam.next = ready ? arm.target : null;

        // a shot is short: then they let go of whom they were on, still drawn. One at no one gives up as soon, unfired
        if ((target === undefined || beam.locked.presence === 0) && free === null) arm.firedSecs = null;
        else if (secs - (arm.firedSecs ??= secs) > phaserConfig.fireSecs) {
          arm.target = arm.firedSecs = null;
          w.hud?.update();
        }
      },
      wieldBlock(npc, arm, target, secs) {
        const { anim } = npc;
        const { armed } = arm;
        const lain = anim.posture === "lie";
        // lowered, only whilst coming down or crouched (`tucked`): what it would swing through or meet
        if (armed === false && anim.crouched === false && isPhaserPose(anim.upper.key) === false) {
          arm.shielded = false;
          return { avoid: false, swingHit: false };
        }
        if (armed === true) state.wieldPoll(npc, arm, secs);
        else arm.shielded = false;
        const swingHit = meetObstacles(npc, arm);
        /** Locked on someone the last cast looked for and could not see: drawn in until it can */
        const blind =
          target !== undefined &&
          arm.casting === false &&
          arm.sight.inSight === false &&
          arm.cast?.target === target.key;
        const blocked = armed === true && (arm.armHit === true || arm.shielded || blind || arm.npcHit);
        // lain, only by a cast as they lie now: a roll leaves the last one stale
        if (blocked === true && (lain === false || isCastCurrent(arm, npc, target) === true)) {
          arm.holdUntil = secs + phaserConfig.holdSecs;
        }
        return { avoid: armed === true && arm.holdUntil > secs, swingHit };
      },
      wieldFacing(npc, arm, target, free) {
        const { anim } = npc;
        const { armed } = arm;
        const sat = anim.posture === "sit";
        const lain = anim.posture === "lie";
        // the aim — only ours, so a look still turns them: at the target, else held so a move strafes
        const { face } = anim;
        /** The middle of the part their aim is held on, untargeted */
        const heldAt = target === undefined && free === null ? heldPoint(w, arm) : null;
        /** Where they lock on, on the ground: their target's part, where a shot at no one ends, or the part held */
        const lockAt =
          target !== undefined
            ? lockPoint(target, arm)
            : free?.at != null
              ? { x: free.at.x, y: free.at.z }
              : heldAt === null
                ? null
                : { x: heldAt.x, y: heldAt.z };
        // lowered, on no one: no aim nor turn of ours to keep or let go
        if (armed === false && lockAt === null && arm.ownAim == null && arm.ownTurn !== true) return heldAt;
        if (sat === true) {
          // sat they turn their head, not round: and only ours to put back
          if (face.aim !== null && face.aim === arm.ownAim) face.aim = arm.ownAim = null;
          if (lockAt !== null) anim.turnTo(bearingPast(npc, lockAt, arm.muzzleRight));
          else if (arm.ownTurn === true && armed === false) anim.turnTo(null); // kept whilst raised
          arm.ownTurn = lockAt !== null || (arm.ownTurn === true && armed === true);
        } else if (lain === true) {
          // lain they do not turn: their arm and head do
          if (face.aim !== null && face.aim === arm.ownAim) face.aim = arm.ownAim = null;
        } else if (face.aim === null || face.aim === arm.ownAim) {
          /** On a move told not to strafe, whose forward gait a held aim would slide */
          const forwardOnly = npc.isMoving() && anim.strafe !== true && anim.strafeFollowsAim !== true;
          if (lockAt !== null) arm.lockAim.at = bearingPast(npc, lockAt, arm.muzzleRight);
          face.aim = arm.ownAim =
            lockAt !== null ? arm.lockAim : armed === true && forwardOnly === false ? heldAim : null;
        }
        return heldAt;
      },
      wieldPitch(npc, arm, heldAt, delta, secs) {
        // its tilt, eased between detents, or to the part held: settled, nothing to do
        if (heldAt === null && arm.pitch === (arm.pitchAt ?? (arm.tilt ?? 0) * phaserConfig.tiltRad)) return;
        const aimNow = heldAt === null ? null : state.aimOf(npc.key);
        if (aimNow !== null && heldAt !== null) {
          arm.pitchAt = Math.atan2(heldAt.y - aimNow.y, Math.hypot(heldAt.x - aimNow.from.x, heldAt.z - aimNow.from.y));
        }
        const pitchTo = arm.pitchAt ?? (arm.tilt ?? 0) * phaserConfig.tiltRad;
        arm.pitch = (arm.pitch ?? 0) + (pitchTo - (arm.pitch ?? 0)) * (1 - Math.exp(-delta / phaserConfig.tiltSecs));
        if (Math.abs(pitchTo - arm.pitch) < 1e-4) arm.pitch = pitchTo;
        else w.r3f?.invalidate();
        // aimed once, let go of as it settles: their facing and pitch stay
        if (aimNow !== null && heldAt !== null && arm.aimAt?.held === false) {
          const bearing = geomService.getThreeRotationY(heldAt.z - aimNow.from.y, heldAt.x - aimNow.from.x);
          const settled =
            arm.pitch === pitchTo && Math.abs(deltaAngle(aimNow.bearing, bearing)) < phaserConfig.aimedRad;
          if (settled || secs - arm.aimAt.secs > phaserConfig.aimSecs) arm.aimAt = null;
        }
      },
      wieldPoll(npc, arm, secs) {
        // through their room, and past a door they are near: the crowd's neighbours stop short of the gun.
        // Shields too, which barely move: the rays lead by their velocity, and a draw-in holds `holdSecs`
        const pollSecs = npc.key === w.player.key ? phaserConfig.sampleSecs : phaserConfig.npcPollSecs;
        if (secs - arm.npcPolledSecs < pollSecs) return;
        arm.npcHit = armMeetsNpc(w, npc, arm, secs);
        /** Their arm at full reach would meet a shield: drawn in, as from a wall */
        const freqs = w.shields?.freqsOf(npc.key);
        const shielded =
          freqs !== undefined && armEnds(npc, arm).some((end) => w.shields.reaches(npc.point, end, freqs));
        if (shielded && arm.shielded === false && npc.key === w.player.key) w.hud?.say("phaser suppressed");
        arm.shielded = shielded;
        arm.npcPolledSecs = secs - Math.random() * pollSecs * 0.5; // jittered, so the armed do not all poll on one frame
      },
      wieldPose(npc, arm, avoid, swingHit) {
        const { anim } = npc;
        const { armed } = arm;
        const lain = anim.posture === "lie";
        // the pose, over their right arm — only ours, never another's e.g. a reach
        /** Lain, rested instead of drawn in: unless the arm is on top, free to draw in */
        const rested = avoid && lain && lieAim[anim.pose]?.drawIn !== true;
        /** Crouched and not raised, the gun is held up out of the way */
        const tucked = armed === false && anim.crouched && state.holds(npc.key);
        const goal = tucked
          ? phaserConfig.avoid
          : armed === false || rested
            ? null
            : avoid
              ? phaserConfig.avoid
              : phaserConfig.pose;
        const sat = anim.posture === "sit";
        const shown = anim.upper.target === 1 ? anim.upper.key : null;
        const shownLeft = anim.upperLeft.target === 1 ? anim.upperLeft.key : null;
        // lowered, at rest or coming down: nothing of ours to put on or let go of
        if (armed === false && tucked === false && isPhaserPose(shown) === false && isPhaserPose(shownLeft) === false)
          return false;
        const settled = anim.upper.blend === 1 && anim.upper.swap === 1;
        /** Stood before an obstacle its swing would meet, the arm goes by `avoid` */
        const via = swingHit && anim.posture === "stand" && tucked === false;
        // raised from rest only once a cast says which way
        const waiting = armed === true && goal === phaserConfig.pose && shown === null && arm.casting === true;
        const pose = waiting ? null : via ? byAvoid(goal, shown, settled) : goal;
        if (pose === null) {
          // raised still, lain, it is rested slowly. Lowered stood still, by `sitArmVia`, its arc kept in. Not an arm `setNearWall` drew in
          if (isPhaserPose(shown) && shown !== anim.armIn)
            anim.setUpper(null, {
              fadeSecs: armed ? phaserConfig.lainLowerSecs : undefined,
              byWall: arm.armHit || (armed === false && anim.moving === false), // walking, its swing would take the hand out
            });
        } else if (pose !== shown && (shown === null || isPhaserPose(shown))) {
          // in before the hand goes through — and a raise from rest keeps the clip's own pace
          const swapSecs =
            pose === phaserConfig.avoid
              ? phaserConfig[arm.armHit ? "wallDrawInSecs" : anim.crouched ? "quickDrawInSecs" : "drawInSecs"]
              : shown === null
                ? undefined
                : phaserConfig.drawOutSecs;
          anim.setUpper(pose, { swapSecs, past: sat, byWall: arm.armHit });
        }
        // the left arm drawn in with the right, so a run's guard keeps off the wall: only ours, never psi's or a reach
        const leftPose = pose === phaserConfig.avoid && tucked === false ? pose : null;
        if (leftPose !== shownLeft && (shownLeft === null || isPhaserPose(shownLeft))) {
          anim.setUpper(leftPose, { side: "left", fadeSecs: phaserConfig.drawInSecs });
        }
        /**
         * Past an obstacle or by a wall, not before the arm is up: the stance's own arm would swing the gun through it.
         * Raised from rest, not before a cast says which.
         */
        return (
          (waiting === false && via === false && arm.armHit === false) ||
          arm.ownIdle !== null ||
          (isPhaserPose(anim.upper.key) && settled)
        );
      },
      wieldReach(npc, arm, on) {
        const { anim } = npc;
        const lain = anim.posture === "lie";
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
        return inReach;
      },
      wieldStance(npc, arm, armUp) {
        const { anim } = npc;
        const { armed } = arm;
        if (armed === false && arm.ownIdle === null) return; // lowered, none of ours to put back
        // the stance — theirs to stand in, and only ours to put back. Sat, lain or crouched, the seat's, bed's or crouch's
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
      },
      async castSpread(npc, from, bearing) {
        const run = phaserConfig.alongMax;
        const { angles } = attachmentBeams.shotgun;
        const y = state.aimOf(npc.key)?.y ?? phaserConfig.castY;
        const ways = angles.map((angle) => ({ x: -Math.sin(bearing + angle), y: -Math.cos(bearing + angle) }));
        const segs = ways.map((way) => ({ src: from, dst: { x: from.x + way.x * run, y: from.y + way.y * run } }));
        const results = await w.e.raycasts(segs, { offMap: true, key: `${npc.key}/spread` }).catch(() => []);
        // each to its wall, else a shield first
        const ends = segs.map(({ dst }, i) => {
          const hit = results[i]?.hit ?? dst;
          const stopped = state.shieldStop(npc.key, results[i]?.shields ?? [], from, y, tmpFree.set(hit.x, y, hit.y));
          return { at: stopped === null ? hit : { x: stopped.at.x, y: stopped.at.z }, face: stopped?.reflect ?? null };
        });
        // off a reflecting one each bar its middle bounces on: the shot's own line's is its own (`bounce`)
        const legs = await state.castLegs(
          npc,
          ends.map(({ at, face }, i) => (face === null || angles[i] === 0 ? null : { at, way: ways[i], face })),
          y,
        );
        return ends.map(({ at }, i) => ({
          dist: Math.hypot(at.x - from.x, at.y - from.y),
          leg: legs[i],
          legEnd: legs[i]?.end ?? null,
        }));
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
          armEnds(npc, arm).map((end, i) =>
            w.e.raycast(npc.point, end, { key: `${npc.key}/reach${i}` }).then(
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
                .raycast(from, targetPoint(target, arm.target, tmpPart), { key: `${npc.key}/sight` })
                .catch(() => w.e.raycast((from = npc.point), target.point, { key: `${npc.key}/sight` })) // its muzzle beyond a wall
                .then(
                  ({ hit, obstacles, shields }): ArmSight => ({
                    across: obstacles,
                    from,
                    inSight: hit === null,
                    shields,
                  }),
                  (): ArmSight => ({ across: [], from, inSight: false, shields: [] }),
                ),
          arm.look?.attachment === "shotgun" ? state.castSpread(npc, from, ry) : null,
        ] as const)
          // else respawned since
          .then(([reach, sight, spread]) => arm.cast === cast && Object.assign(arm, { reach, sight, spread }))
          .finally(() => {
            arm.casting = false;
            w.r3f?.invalidate();
          });
      },
    }),
    // the attributes wrap the data
    {
      reset: { gun: true, beams: true, impacts: true, landed: true },
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
    Object.assign(state.gun.mat, gunNodes(state.gun, state, w.view), { needsUpdate: true });
    state.beams.mats.forEach((mat, i) => Object.assign(mat, beamNodes(state, w.view, i === 1), { needsUpdate: true }));
    Object.assign(state.impacts.mat, impactNodes(state, w.view), { needsUpdate: true });
    state.onTick(); // a fresh geometry has no instances yet
  }, [w.view.fadeRoomsFx.uid]);

  return (
    <group>
      <primitive object={state.gun.mesh} />
      <primitive object={state.beams.mesh} />
      <primitive object={state.impacts.mesh} />
    </group>
  );
}

/** Which of a shot's rays met them: its own line, beyond whom it passed, an attachment's other rays, or a bounce */
export type ShotRay = "own" | "beyond" | "side" | "bounce";

/** Decides `npcKey`'s outcome as `by`'s shot meets them. `undefined` leaves it to the debug badge */
export type ShotDecide = (meet: {
  by: string;
  npcKey: string;
  ray: ShotRay;
  attachment: null | GunAttachment;
}) => undefined | JshCli.ShotOutcome;

export type State = PhaserUniforms & {
  /** A shot at no one stopped by a reflecting shield bounces off it once: its `leg`, by a raycast, and whom it meets there */
  bounce(npc: Npc, arm: ArmEntry, shot: FreeShot): Promise<void>;
  /** A struck shot's bounce lands: on whom it met, unless another ray took its hit, a ring there */
  strikeLeg(npc: Npc, shot: FreeShot): void;
  /**
   * An attachment's rays from `tip` along the shot's way to `end`, bar its own line: each ends on the nearest npc it meets.
   * Sets `arm.spreadHit`
   */
  spreadOn(npc: Npc, arm: ArmEntry, tip: THREE.Vector3, end: THREE.Vector3): void;
  /**
   * How far a shotgun's rays go from `from` along `bearing`, on the ground, as `attachmentBeams.shotgun.angles`: to a wall,
   * else a shield. Off a reflecting one each bar the middle bounces on: its leg
   */
  castSpread(npc: Npc, from: Geom.VectJson, bearing: number): Promise<(SpreadRay & { leg: null | Leg })[]>;
  /** Where a shield of those `shields` stops their shot from `from`, `y` metres up, to `to`, and whether it reflects: else `null` */
  shieldStop(
    npcKey: string,
    shields: readonly string[],
    from: Geom.VectJson,
    y: number,
    to: THREE.Vector3,
  ): null | { at: THREE.Vector3; reflect: null | { a: Geom.VectJson; b: Geom.VectJson } };
  /** A ray of their shot landing `at` on `on`'s `part`, from `from`: a ring, sparks off armour. The first on them takes its hit */
  landRay(
    npc: Npc,
    on: Npc,
    part: null | string,
    outcome: JshCli.ShotOutcome,
    at: THREE.Vector3,
    from: THREE.Vector3,
  ): void;
  /** Each start's bounce off its shield, `y` metres up, cast as one: `null` for none */
  castLegs(
    npc: Npc,
    starts: (null | { at: Geom.VectJson; way: Geom.VectJson; face: { a: Geom.VectJson; b: Geom.VectJson } })[],
    y: number,
  ): Promise<(null | Leg)[]>;
  /** One instance per gun shown */
  gun: GunResources;
  /** One instance per beam segment shown */
  beams: BeamResources;
  /** One instance per impact still fading */
  impacts: ImpactResources;
  /** Where shots landed, oldest first, until faded */
  landed: Landed[];
  /** A shot of `npc`'s from `from` landed `at`, on `on` or on what stopped it: a ring there */
  impact(npc: Npc, at: THREE.Vector3, from: THREE.Vector3, on: null | Npc): void;
  /** Every impact still fading, sending only those, as one lands or fades */
  writeImpacts(): void;
  /** By npcKey: whoever is armed, or whose gun or beam still fades */
  arms: Map<string, ArmEntry>;
  /** By npcKey: how jsh `phaser` overrides their phaser's look. Not saved */
  looks: Map<string, Partial<PhaserLook>>;
  /** Overrides each npc's outcome as a shot meets them, e.g. set from jsh. `undefined` leaves it to the debug badge */
  decide: null | ShotDecide;
  /** Their shot's outcome on `on`, met by `ray`: `decide`'s, else the debug badge's. Decided once per npc a shot (`arm.met`) */
  outcomeFor(npc: Npc, on: Npc, ray: ShotRay): JshCli.ShotOutcome;
  /** Over a pale deck, where beams are laid over it rather than added: see `syncTheme` */
  pale: boolean;
  /** By npcKey: who put theirs away, so `holds` is false until `arm` draws it */
  stowed: Set<string>;
  tickedSecs: number;

  /** Their aim whilst armed: from the muzzle at full aim, on the ground, and its bearing. See `service/aim-target` */
  aimOf(npcKey: string): null | import("../service/aim-target").Aim;
  /** Aims them at `at`'s part, facing and pitched there, until aimed. `held`: until they tilt or lower. `null` lets go */
  aimAt(npcKey: string, at: null | { npcKey: string; part: string; held?: boolean }): void;
  /** Their aim as a ray from the muzzle, pitched by their tilt: `null` unless armed */
  aimRay(npcKey: string, out: THREE.Ray): null | THREE.Ray;
  /** Fired: the shot takes their charge so far, ending it */
  takeCharge(arm: ArmEntry): void;
  /** Tilts them to a detent: down, level or up. Lowering levels it */
  tilt(npcKey: string, tilt: Tilt): void;
  /** Arm them, locked on `at` an npc's `part` — no `at` unlocks */
  /** `once`: lowered again once the shot is over. `toward`: sat or lain, whom they point at without locking on */
  /** `local`: where on the part it lands, in its bone's frame */
  arm(
    npcKey: string,
    opts?: { at?: null | string; part?: null | string; local?: null | THREE.Vector3; once?: boolean; toward?: string },
  ): void;
  /** The bearing that faces `npcKey` at `at`: armed, their muzzle's line through it. `null` without them */
  bearingFor(npcKey: string, at: Geom.VectJson): null | number;
  /** How high their gun is held, as it is raised whilst stood or crouched */
  gunHeight(npcKey: string): number;
  /** Ends their charge into a cooldown, the phaser left raised: `false` if not charging */
  cancelCharge(npcKey: string): boolean;
  /** Starts charging their shot, fired on `arm` with a target or `fireAlong`: `false` unless raised, nor cooling, nor drawn in */
  charge(npcKey: string): boolean;
  /** Their charge so far, `0` to `1` over `chargeSecs` */
  chargeOf(npcKey: string): number;
  /** Where a shot at no one ends: one cast along their aim, pitched as it is. Npcs are not looked for */
  castAlong(npc: Npc, arm: ArmEntry, shot: FreeShot): Promise<void>;
  /** Where a shot at no one along each one's aim would end now, and the rooms it passes through, in one worker request */
  /** `null` where it cannot be cast */
  endsAlong(npcKeys: string[]): Promise<(null | AlongEnd)[]>;
  /** Lowers it: their pose, stance and aim are let go of, and the beam fades. The gun stays in hand: see `stow` */
  disarm(...npcKeys: string[]): void;
  /** Writes their gun as instance `i`, and up to `room` of their beam's segments from instance `j`, to `dst` if any. The segments written, else `-1` with no forearm to hold it */
  draw(npc: Npc, arm: ArmEntry, dst: undefined | Npc, i: number, j: number, room: number): number;
  /** Their phaser's look: its item's meta, overridden by `setLook` */
  lookOf(npcKey: string): PhaserLook;
  /** Overrides their phaser's look, field by field, until the page reloads. `null` clears it. Throws on a bad field */
  setLook(npcKey: string, look: null | Partial<PhaserLook>): void;
  /** Their entry, made if absent */
  ensure(npcKey: string): ArmEntry;
  /** Fires at no one, along their aim, raising it if need be: `false` if it cannot be raised. `end`: already found */
  fireAlong(npcKey: string, end?: Omit<AlongEnd, "rooms">): boolean;
  /** Where a shot at no one ends: its length along their live aim, so it follows a strafe as the dot does */
  freeEndOf(npc: Npc, arm: ArmEntry, shot: FreeShot, out: THREE.Vector3): null | THREE.Vector3;
  /** How brightly the gun glows and how hard it shakes at game `now`: its charge, else draining after a cancel */
  glowOf(arm: ArmEntry, now: number): number;
  /** Gives them an entry if they hold one and have none: told by events, not looked for each tick */
  hold(npcKey: string): void;
  /** Carries one, stands and has not stowed it, so has it in hand — raised or not */
  holds(npcKey: string): boolean;
  isArmed(npcKey: string): boolean;
  isCharging(npcKey: string): boolean;
  /** Raised and aimed in earnest (Space held): the left hand steadies it, the view extends to the dot, and a click fires */
  isSteadied(npcKey: string): boolean;
  /** Aims in earnest, or not: see `isSteadied` */
  steady(npcKey: string, on: boolean): void;
  /** Puts it away: lowered, and the gun fades from their hand until drawn again by `arm` */
  stow(...npcKeys: string[]): void;
  /** Draining after a cancelled charge: none charges until it ends */
  isCooling(npcKey: string): boolean;
  /** Armed, and drawn in: `phaser_aim_avoid`, or lain, rested */
  isDrawnIn(npcKey: string): boolean;
  /** Armed, and the arm all the way up */
  isRaised(npcKey: string): boolean;
  /** Armed, and locked on someone */
  isLocked(npcKey: string): boolean;
  /** Lowers it, returning what raises it again as it was: `null` if it was not raised */
  lowerAwhile(npcKey: string): null | (() => void);
  /** Look again at every arm and line of sight, e.g. a door changed */
  markDirty(): void;
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
  shoot(npc: Npc, arm: ArmEntry, to: NpcTarget): void;
  /** The line from their muzzle through `to`'s point meets a part of `dst`'s, which `to` then takes: `false` for none */
  meetPart(npc: Npc, arm: ArmEntry, dst: Npc, to: NpcTarget): boolean;
  /** Whom a shot passing its target meets beyond, short of the wall, ghosts passed through: `shot.beyond` */
  passOn(npc: Npc, arm: ArmEntry, shot: ArmShot): void;
  /** A shot by `npc` from `from` reached `dst`'s `part` at `at`: its effect, its event, and a word to the player if it did not hit */
  land(
    npc: Npc,
    dst: Npc,
    part: null | string,
    outcome: JshCli.ShotOutcome,
    at: THREE.Vector3,
    from: THREE.Vector3,
  ): void;
  sync(): void;
  /**
   * Each tick, their phaser from their entry, step by step: see "Each tick" in `docs/inventory.md`.
   * A step skips itself lowered and at rest, so a phaser merely carried costs little
   */
  wield(npc: Npc, arm: ArmEntry, delta: number): void;
  /** Where the arm points, sat or lain, tilted or after the beam, and the muzzle held on the aim's line */
  wieldAim(npc: Npc, arm: ArmEntry, on: undefined | Npc, inReach: boolean, delta: number): void;
  /** The gun in hand, and the beam: locked on whilst aiming and in sight */
  wieldBeam(
    npc: Npc,
    arm: ArmEntry,
    target: undefined | Npc,
    free: null | FreeShot,
    inReach: boolean,
    avoid: boolean,
    secs: number,
  ): void;
  /** What draws the arm in (`avoid`): a wall, obstacle, shield, someone in the way, a target out of sight. `swingHit` an obstacle a raise or lower would swing through */
  wieldBlock(npc: Npc, arm: ArmEntry, target: undefined | Npc, secs: number): { avoid: boolean; swingHit: boolean };
  /** Their facing, sat, lain or stood: at whom or where they lock on, else held so a move strafes. Returns the part held */
  wieldFacing(npc: Npc, arm: ArmEntry, target: undefined | Npc, free: null | FreeShot): null | THREE.Vector3;
  /** The tilt, eased between detents or to the part held, and an aim let go of once it settles */
  wieldPitch(npc: Npc, arm: ArmEntry, heldAt: null | THREE.Vector3, delta: number, secs: number): void;
  /** Armed, someone in the way and shields within reach, polled: often for the player, less for npcs */
  wieldPoll(npc: Npc, arm: ArmEntry, secs: number): void;
  /** The pose over their right arm, and the left drawn in with it. Returns whether the arm is up, for the stance */
  wieldPose(npc: Npc, arm: ArmEntry, avoid: boolean, swingHit: boolean): boolean;
  /** Whether `on` is within their aim's reach: lain, they roll to point there if they can */
  wieldReach(npc: Npc, arm: ArmEntry, on: undefined | Npc): boolean;
  /** The idle they stand in whilst raised, once the arm is up, and theirs put back once lowered */
  wieldStance(npc: Npc, arm: ArmEntry, armUp: boolean): void;
  /** Raycast `reach` ahead and to the target — but only once something has changed, and one at a time */
  recast(npc: Npc, arm: ArmEntry, target: undefined | Npc, secs: number): void;
  /** Respawned armed, they lower it at once: the gun is never left raised into a wall it was put beside */
  respawned(npcKey: string): void;
};

/** A phaser's detent: down, level or up */
/** Where a shot at no one would end, and the rooms its cast passed through */
type AlongEnd = {
  at: THREE.Vector3;
  what: StruckKind;
  decorKey: null | string;
  dist: number;
  rooms: Geomorph.GmRoomKey[];
  /** The reflecting shield it ended on, to bounce off */
  reflect: null | { a: Geom.VectJson; b: Geom.VectJson };
};

/** Where a shot landed, as an impact draws it */
type Landed = {
  at: THREE.Vector3;
  /** The shot's way there, unit */
  way: THREE.Vector3;
  size: number;
  rgb: [number, number, number];
  /** Game seconds it landed */
  secs: number;
  room: number;
  lit: number;
};

/** A shot passing them waits until it knows whom it meets beyond, and every ghost among them is one */
function shotWaits(w: import("./World").State, shot: ArmShot) {
  if (shot.through !== null && shot.beyond === null) return true;
  const ghosts = w.npcGhost;
  return ghosts?.isGhosting(shot.to.npcKey) === true || shot.beyond?.some((b) => ghosts?.isGhosting(b.npcKey)) === true;
}

/** Where a ray from `from` along `dir` meets a wall, within `passMax` metres. `null` where it cannot be cast */
function wallBeyond(w: import("./World").State, from: Geom.VectJson, dir: Geom.VectJson) {
  const to = { x: from.x + dir.x * phaserConfig.passMax, y: from.y + dir.y * phaserConfig.passMax };
  return w.e.raycast(from, to, { offMap: true, key: "beyond" }).then(
    (result) => result.hit ?? to,
    () => null,
  );
}

/** Does their gun at full aim meet someone in their room: their body or shoulders, or their arm whilst raised? Not one lying down, or dead */
function armMeetsNpc(w: import("./World").State, npc: Npc, arm: ArmEntry, secs: number) {
  const ours = gunLine(npc, arm);
  const [mx, mz] = [(ours[0] + ours[2]) / 2, (ours[1] + ours[3]) / 2];
  const { armWidth, bodyRadius, reach } = phaserConfig;
  /** Further off than this either way, neither their body nor their gun is in reach */
  const far = 1.5 * reach + npcDims.agentRadius + 2 * armWidth;
  /** The player gives way to no npc's arm */
  const player = npc.key === w.player.key;
  /** Those in their room, and those near a door they are near: the arm may reach through it */
  const others = w.npc.near.atDoors(npc.key, w.npc.near.inReach(npc.key, 0));
  return others.some((other) => {
    if (other.anim.dead === true || other.anim.posture === "lie") return false; // lain, or a corpse: below the arm
    const p = other.position;
    if (Math.abs(p.x - mx) > far || Math.abs(p.z - mz) > far) return false;
    const stood = other.anim.posture === "stand";
    // stood, a capsule round the line between their shoulders, which stand wider than their middle
    const shoulders = stood ? shouldersOf(other) : null;
    const apart = shoulders === null ? toSeg(p.x, p.z, ours) : segsApart(ours, shoulders);
    if (apart < (stood ? bodyRadius : npcDims.agentRadius) + armWidth) return true;
    if (player === true) return false;
    const theirs = w.phasers.arms.get(other.key);
    // only an arm up now: of two that would meet, whoever raised first keeps it
    if (theirs === undefined || theirs.armed === false || theirs.holdUntil > secs) return false;
    return segsApart(ours, gunLine(other, theirs)) < 2 * armWidth;
  });
}

/** The middle of the part their aim is held on: `null` for none, forgetting one whose npc has gone */
function heldPoint(w: import("./World").State, arm: ArmEntry) {
  const npc = arm.aimAt == null ? undefined : w.n[arm.aimAt.npcKey];
  if (npc === undefined || arm.aimAt == null) return (arm.aimAt = null);
  return bodyPartPoint(npc, arm.aimAt.part, tmpHeld);
}

/** Whether nothing of them is drawn: their room out of view, and they not lit of themselves — as `seenBy` */
const unseen = (w: import("./World").State, npc: Npc) =>
  w.view.fadeRoomsFx.isHidden(npc.roomSlot.value) === true && npc.npcLit.value * w.view.litNpcsEnabled.value === 0;

/** Shows the first `count` instances, uploading only those. With none, there is no draw call */
function upload({ mesh, attrs }: { mesh: THREE.Mesh; attrs: THREE.InstancedBufferAttribute[] }, count: number) {
  mesh.visible = count > 0;
  if (count === 0) return;
  (mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = count;
  for (const attr of attrs) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, count * attr.itemSize);
    attr.needsUpdate = true;
  }
}

/** Writes instance `i`'s four floats, with no array made for them */
function put(data: Float32Array, i: number, a: number, b: number, c: number, d: number) {
  const at = i * 4;
  data[at] = a;
  data[at + 1] = b;
  data[at + 2] = c;
  data[at + 3] = d;
}
const tmpTip = new THREE.Vector3();
const tmpMuzzle = new THREE.Vector3();
const tmpPart = new THREE.Vector3();
const tmpBody = new THREE.Vector3();
const tmpAlong = new THREE.Vector3();
const tmpAt = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpRoll = new THREE.Quaternion();
const tmpShake = new THREE.Quaternion();
const tmpArmWant = new THREE.Vector3();
const tmpPast = new THREE.Vector3();
const tmpAcross = new THREE.Vector3();
const tmpFree = new THREE.Vector3();
const tmpHeld = new THREE.Vector3();
const tmpShotRay = new THREE.Ray();
const tmpShotDir = new THREE.Vector3();
const tmpAimRay = new THREE.Ray();
