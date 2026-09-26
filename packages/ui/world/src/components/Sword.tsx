import { useStateRef } from "@npc-cli/util";
import { useContext, useMemo } from "react";
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cross,
  Discard,
  Fn,
  float,
  fract,
  max,
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
import { WorldContext } from "./world-context";

/**
 * A rope from each pointer's right hand — a faint stub whilst unlocked, else arcing up and down onto
 * their target's head. One instance per pointer, shaped in the vertex shader: see `demo_sword`
 */
export default function Sword() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ...createSwordResources(),
      swords: new Map(),
      tickedMs: performance.now(),

      aim(srcKey, dstKey) {
        const sword = state.swords.get(srcKey) ?? { dstKey: null, next: null, shown: off(), locked: off() };
        state.swords.set(srcKey, Object.assign(sword, { next: dstKey }));
        sword.shown.target = 1;
        state.sync();
      },
      sheathe(srcKey) {
        const sword = state.swords.get(srcKey);
        if (sword === undefined) return;
        sword.shown.target = 0;
        state.sync();
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
          if (sword.next !== null && w.n[sword.next] === undefined) sword.next = null;
          // a new target: back to the stub, then out to it
          if (sword.dstKey !== sword.next && sword.locked.presence === 0) sword.dstKey = sword.next;
          sword.locked.target = sword.dstKey !== null && sword.dstKey === sword.next ? 1 : 0;
          approach(sword.shown, step);
          approach(sword.locked, step);
          if (npc === undefined || (sword.shown.presence === 0 && sword.shown.target === 0)) {
            state.swords.delete(srcKey);
            continue;
          }
          if (count === MAX_SWORDS) continue;

          const hand = npc.group?.getObjectByName("rightforearm");
          if (hand === undefined) continue;
          hand.updateWorldMatrix(true, false); // else a frame stale: the frameloop is on demand
          const tip = hand.localToWorld(tmpTip.fromArray(swordConfig.handTip));
          const ry = npc.rotation.y;
          const stubEnd = tmpEnd.set(
            tip.x - Math.sin(ry) * swordConfig.stub,
            tip.y,
            tip.z - Math.cos(ry) * swordConfig.stub,
          );
          const dst = sword.dstKey === null ? undefined : w.n[sword.dstKey];
          const locked = eased(sword.locked.presence);
          if (dst !== undefined) {
            const overY = dst.position.y + dst.anim.headY + swordConfig.headAbove;
            stubEnd.lerp(tmpOver.set(dst.position.x, overY, dst.position.z), locked);
          }
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
          if (sword.next !== sword.dstKey) sword.dstKey = sword.next;
          sword.shown.presence = sword.shown.target;
          sword.locked.presence = sword.dstKey === null ? 0 : 1;
        }
      },
      sync() {
        if (w.disabled === true) state.snap(); // paused: nothing fades, so a change is at once
        state.onTick();
        w.r3f?.invalidate();
      },
    }),
    { reset: { geo: true, mat: true, mesh: true } },
  );

  w.sword = state;

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
  /** Per pointer: whom they are locked on to, whom they are to be, and how far into view each is */
  swords: Map<string, { dstKey: null | string; next: null | string; shown: Presence; locked: Presence }>;
  tickedMs: number;

  /** Show `srcKey`'s sword: locked on to `dstKey`, else the stub */
  aim(srcKey: string, dstKey: null | string): void;
  /** Fade out `srcKey`'s sword */
  sheathe(srcKey: string): void;
  onTick(): void;
  /** Every fade straight to its end */
  snap(): void;
  sync(): void;
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
  const { lift, liftPerMetre, r0, r1, alpha, bands, color } = swordConfig;
  const src = attribute<"vec4">("swordSrc", "vec4");
  const dst = attribute<"vec4">("swordDst", "vec4");
  const [shown, locked] = [src.w, dst.w];
  const t = positionLocal.y.add(0.5);

  // a cubic Bézier whose middle points are the ends raised by `h`: `mix` by smoothstep, plus a hump
  const d = dst.xyz.sub(src.xyz);
  const h = locked.mul(float(lift).add(d.length().mul(liftPerMetre)));
  const up = vec3(0, 1, 0);
  const onRope = mix(src.xyz, dst.xyz, t.mul(t).mul(t.mul(-2).add(3))).add(up.mul(h.mul(3).mul(t).mul(t.oneMinus())));
  const tangent = d.mul(max(t.mul(t.oneMinus()).mul(6), 0.01)).add(up.mul(h.mul(3).mul(t.mul(-2).add(1))));
  // the rope lies in the upright plane through both ends
  const side = normalize(vec3(d.z.negate(), 0, d.x).add(vec3(1e-4, 0, 0)));
  const normal = normalize(cross(side, tangent));
  const radius = mix(float(r0), mix(float(r0), float(r1), locked), t.mul(t)).mul(shown);
  const p = onRope.add(side.mul(positionLocal.x).add(normal.mul(positionLocal.z)).mul(radius));
  const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1)));

  const along = varying(t, "vSwordT");
  const vShown = varying(shown, "vSwordShown");
  const vLocked = varying(locked, "vSwordLocked");
  const colorNode = Fn(() => {
    const stubFade = mix(along.oneMinus(), float(1), vLocked); // a stub dies away at its tip
    const flow = smoothstep(0.6, 1, fract(along.mul(bands).sub(phase)))
      .mul(0.5)
      .add(0.5); // pulses towards the target
    const a = objectPick.notEqual(0).select(0, vShown.mul(stubFade).mul(flow).mul(foldNode).mul(alpha));
    Discard(a.lessThan(1 / 512));
    return vec4(uniform(new THREE.Color(color)), a);
  })();

  return { vertexNode, colorNode };
}

const MAX_SWORDS = 32;
const tmpTip = new THREE.Vector3();
const tmpEnd = new THREE.Vector3();
const tmpOver = new THREE.Vector3();
