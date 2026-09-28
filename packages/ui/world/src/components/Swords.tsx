import { useStateRef } from "@npc-cli/util";
import { deltaAngle } from "maath/misc";
import { useContext, useEffect, useMemo } from "react";
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cross,
  Discard,
  Fn,
  float,
  fract,
  mix,
  normalize,
  positionLocal,
  smoothstep,
  uniform,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { swordConfig } from "../const.npc";
import type { Npc } from "./npc";
import { WorldContext } from "./world-context";

/**
 * Npcs' swords: whilst drawn they point (upper body), drawing in to `defensive` whenever the arm would touch a
 * crowd neighbour, a wall or a closed door, and a rope runs from the wrist — a faint stub, else straight to the
 * middle of a body part of their target whilst nothing is between them. Theirs, not a process's: see `w.swords` and jsh `sword`
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
          const rope = {
            dstKey: null,
            dstPart: null,
            next: null,
            shown: off(),
            locked: off(),
            glide: null,
            end: new THREE.Vector3(),
          };
          sword = {
            drawn: false,
            target: null,
            bodyPart: null,
            holdUntil: 0,
            ownAim: null,
            ...rope,
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
      lock(srcKey, dstKey, bodyPart) {
        const sword = state.ensure(srcKey);
        sword.target = dstKey === srcKey ? null : dstKey;
        sword.bodyPart = bodyPart ?? null;
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
      onTick() {
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

          if (sword.next !== null && w.n[sword.next] === undefined) sword.next = null;
          if (sword.dstKey !== sword.next || sword.dstPart !== sword.bodyPart) {
            // a new target or body part: glides there whilst locked on, else comes out from the stub once back to it
            const gliding = sword.dstKey !== null && sword.next !== null && sword.locked.presence > 0;
            if (gliding) sword.glide = { from: sword.end.clone(), t: 0 };
            if (gliding || sword.locked.presence === 0)
              Object.assign(sword, { dstKey: sword.next, dstPart: sword.bodyPart });
          }
          sword.locked.target = sword.dstKey !== null && sword.dstKey === sword.next ? 1 : 0;
          approach(sword.shown, step);
          approach(sword.locked, step);
          if (sword.drawn === false && sword.target === null && sword.shown.presence === 0) {
            state.swords.delete(srcKey); // sheathed, its pose and aim already let go of
            continue;
          }
          if (sword.shown.presence === 0 || count === MAX_SWORDS) continue;

          const hand = npc.group?.getObjectByName("rightforearm");
          if (hand === undefined) continue;
          hand.updateWorldMatrix(true, false); // else a frame stale: the frameloop is on demand
          const tip = hand.localToWorld(tmpTip.fromArray(swordConfig.ropeFrom));
          const ry = npc.rotation.y;
          const stubEnd = tmpEnd.set(
            tip.x - Math.sin(ry) * swordConfig.stub,
            tip.y,
            tip.z - Math.cos(ry) * swordConfig.stub,
          );
          const dst = sword.dstKey === null ? undefined : w.n[sword.dstKey];
          const locked = eased(sword.locked.presence);
          if (dst !== undefined) {
            const at = bodyPartPoint(dst, sword.dstPart, tmpAt);
            if (sword.glide !== null) {
              sword.glide.t = Math.min(1, sword.glide.t + step);
              at.lerpVectors(sword.glide.from, tmpGlide.copy(at), eased(sword.glide.t)); // tracks the target meanwhile
              if (sword.glide.t === 1) sword.glide = null;
            }
            stubEnd.lerp(at, locked);
          }
          sword.end.copy(stubEnd);
          state.srcData.set([tip.x, tip.y, tip.z, eased(sword.shown.presence)], count * 4);
          state.dstData.set([stubEnd.x, stubEnd.y, stubEnd.z, locked], count * 4);
          count++;
        }

        state.mesh.visible = count > 0; // else no draw call
        if (count === 0) return; // nor any upload
        state.geo.instanceCount = count;
        state.geo.getAttribute("swordSrc").needsUpdate = true;
        state.geo.getAttribute("swordDst").needsUpdate = true;
      },
      snap() {
        for (const sword of state.swords.values()) {
          Object.assign(sword, { dstKey: sword.next, dstPart: sword.bodyPart, glide: null });
          sword.shown.presence = sword.shown.target;
          sword.locked.presence = sword.dstKey === null ? 0 : 1;
        }
      },
      sync() {
        if (w.disabled === true) state.snap(); // paused: nothing fades, so a change is at once
        state.onTick();
        w.r3f?.invalidate();
      },
      wield(npc, sword) {
        const secs = w.timer.getElapsedTime();
        const target = sword.drawn === true && sword.target !== null ? w.n[sword.target] : undefined;
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
        sword.shown.target = sword.drawn === true && defensive === false ? 1 : 0;
        if (defensive === false) sword.next = target !== undefined && sword.inSight === true ? target.key : null;
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

  useMemo(() => {
    const { vertexNode, colorNode } = swordNodes(state, w.view);
    state.mat.vertexNode = vertexNode;
    state.mat.colorNode = colorNode;
    state.mat.needsUpdate = true;
    state.onTick(); // a fresh geometry has no instances yet
  }, []);

  return <primitive object={state.mesh} />;
}

export type State = Resources & {
  /** Per npc with a sword drawn, fading, or locked on to someone */
  swords: Map<string, SwordEntry>;
  tickedMs: number;

  /** Draw their swords */
  draw(...npcKeys: string[]): void;
  /** Their entry, made if absent */
  ensure(npcKey: string): SwordEntry;
  isDrawn(npcKey: string): boolean;
  /** Lock them on to `dstKey` whilst drawn and in sight — `null`, or themself, unlocks */
  lock(srcKey: string, dstKey: null | string, bodyPart?: null | string): void;
  /** Look again at every arm and line of sight, e.g. a door changed */
  markDirty(): void;
  /** Sheathe their swords: the pose and aim are let go of, and the rope fades */
  sheathe(...npcKeys: string[]): void;
  toggle(npcKey: string): boolean;
  onTick(): void;
  /** Every fade straight to its end */
  snap(): void;
  sync(): void;
  /** Their pose, aim and rope from their sword's state */
  wield(npc: Npc, sword: SwordEntry): void;
  /** Raycast ahead and to the target — but only once something has changed, and one at a time */
  recast(npc: Npc, sword: SwordEntry, target: undefined | Npc, secs: number): void;
};

type SwordEntry = {
  drawn: boolean;
  /** Whom they lock on to whilst drawn and in sight */
  target: null | string;
  /** Which of `target`'s bones' parts, e.g. `head` — `null`, or none such, is over their head */
  bodyPart: null | string;
  /** World seconds they stay defensive until */
  holdUntil: number;
  /** The aim we set, so we replace or clear only ours */
  ownAim: Npc["anim"]["face"]["aim"];
  /** The rope: whom it is locked on to, whom it is to be, and how far into view each is */
  dstKey: null | string;
  dstPart: null | string;
  next: null | string;
  /** Whilst locked on, gliding to a new target or body part: from where the end was, and how far along */
  glide: null | { from: THREE.Vector3; t: number };
  /** Where the rope ended, last tick */
  end: THREE.Vector3;
  shown: Presence;
  locked: Presence;
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

type Presence = { presence: number; target: 0 | 1 };
type Resources = ReturnType<typeof createSwordResources>;

const off = (): Presence => ({ presence: 0, target: 0 });
const eased = (x: number) => x * x * (3 - 2 * x);

/** Steps `x.presence` towards its target by at most `step` */
function approach(x: Presence, step: number) {
  x.presence += Math.max(-step, Math.min(step, x.target - x.presence));
}

function createSwordResources() {
  // unit ring about `y`, open-ended: `y + 0.5` is how far along the rope
  const base = new THREE.CylinderGeometry(1, 1, 1, swordConfig.sides, swordConfig.segments, true);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setIndex(base.getIndex());
  geo.instanceCount = 0;

  // the hand's tip and eased shown, the end and eased locked
  const srcData = new Float32Array(MAX_SWORDS * 4);
  const dstData = new Float32Array(MAX_SWORDS * 4);
  geo.setAttribute("swordSrc", new THREE.InstancedBufferAttribute(srcData, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("swordDst", new THREE.InstancedBufferAttribute(dstData, 4).setUsage(THREE.DynamicDrawUsage));
  const phase = uniform(0);

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = +5;

  return { geo, mat, mesh, srcData, dstData, phase };
}

function swordNodes(
  { phase }: Resources,
  {
    objectPick,
    foldNode,
  }: { objectPick: THREE.UniformNode<"float", number>; foldNode: THREE.UniformNode<"float", number> },
) {
  const { r0, r1, alpha, faint, solid, nearMetres, bands, color } = swordConfig;
  const src = attribute<"vec4">("swordSrc", "vec4");
  const dst = attribute<"vec4">("swordDst", "vec4");
  const [shown, locked] = [src.w, dst.w];
  const t = positionLocal.y.add(0.5);

  const d = dst.xyz.sub(src.xyz);
  const onRope = mix(src.xyz, dst.xyz, t);
  const side = normalize(vec3(d.z.negate(), 0, d.x).add(vec3(1e-4, 0, 0)));
  const normal = normalize(cross(side, d));
  const radius = mix(float(r0), mix(float(r0), float(r1), locked), t.mul(t)).mul(shown);
  const p = onRope.add(side.mul(positionLocal.x).add(normal.mul(positionLocal.z)).mul(radius));
  const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1)));

  const along = varying(t, "vSwordT");
  const vShown = varying(shown, "vSwordShown");
  const vLocked = varying(locked, "vSwordLocked");
  /** Metres short of the end, where a locked rope meets the body part */
  const toEnd = varying(t.oneMinus().mul(d.length()), "vSwordToEnd");
  const colorNode = Fn(() => {
    const flow = smoothstep(0.6, 1, fract(along.mul(bands).sub(phase)))
      .mul(0.5)
      .add(0.5); // pulses towards the target
    /** A stub dies away at its tip */
    const stub = along.oneMinus().mul(flow).mul(alpha);
    /** Faint and pulsing on the way, solid as it nears the part */
    const lockedOn = mix(flow.mul(faint), float(solid), smoothstep(0, nearMetres, toEnd).oneMinus());
    const a = objectPick.notEqual(0).select(0, vShown.mul(mix(stub, lockedOn, vLocked)).mul(foldNode));
    Discard(a.lessThan(1 / 512));
    return vec4(uniform(new THREE.Color(color)), a);
  })();

  return { vertexNode, colorNode };
}

const MAX_SWORDS = 128;

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
const tmpEnd = new THREE.Vector3();
const tmpAt = new THREE.Vector3();
const tmpGlide = new THREE.Vector3();

/** The middle of `part` on `npc`, in world space — over their head, where their label is, for none */
function bodyPartPoint(npc: Npc, part: null | string, out: THREE.Vector3) {
  const bone = part === null || part === "label" ? undefined : npc.skinnedMesh.skeleton.getBoneByName(part);
  const centre = bone === undefined ? undefined : partCentres(npc.skinnedMesh).get(bone.name);
  if (bone === undefined || centre === undefined) {
    return out.set(npc.position.x, npc.position.y + npc.anim.headY + swordConfig.headAbove, npc.position.z);
  }
  bone.updateWorldMatrix(true, false); // else a frame stale: the frameloop is on demand
  return out.copy(centre).applyMatrix4(bone.matrixWorld);
}

/** Each bone's part: the middle of what it moves most, in its own frame, off the bind pose — one rig for all */
function partCentres(mesh: THREE.SkinnedMesh) {
  let centres = partCentresByGeo.get(mesh.geometry);
  if (centres !== undefined) return centres;
  const { skeleton, geometry: geo } = mesh;
  const [position, joints, weights] = ["position", "skinIndex", "skinWeight"].map((key) => geo.getAttribute(key));
  const boxes = skeleton.bones.map(() => new THREE.Box3());
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (weights.getComponent(i, k) > weights.getComponent(i, best)) best = k;
    const j = joints.getComponent(i, best);
    boxes[j].expandByPoint(
      v.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(skeleton.boneInverses[j]),
    );
  }
  centres = new Map(
    skeleton.bones.flatMap((bone, j) =>
      boxes[j].isEmpty() ? [] : [[bone.name, boxes[j].getCenter(new THREE.Vector3())]],
    ),
  );
  partCentresByGeo.set(geo, centres);
  return centres;
}

const partCentresByGeo = new WeakMap<THREE.BufferGeometry, Map<string, THREE.Vector3>>();
