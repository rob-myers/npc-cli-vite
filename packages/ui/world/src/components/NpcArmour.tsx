import { useStateRef } from "@npc-cli/util";
import { useContext } from "react";
import * as THREE from "three/webgpu";
import { armourConfig } from "../const.npc";
import { type ArmourStreaks, createArmourStreaks, MAX_ARMOUR_STREAKS, streakAttrs } from "../service/armour";
import { bodyPart } from "../service/phaser-beam";
import type { Npc } from "./npc";
import { WorldContext } from "./world-context";

/** Armour: struck, they flinch, and the shot glances off the face it met in a spray of sparks — see `docs/engagements.md` */
export default function NpcArmour() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      bursts: [],
      streaks: createArmourStreaks(w.view.objectPick),

      flash(npc, part, at, from) {
        const d = new THREE.Vector3().subVectors(at, from).normalize();
        // the face it met, else back the way it came
        const n = faceNormalOf(npc, part, at, d, new THREE.Vector3()) ?? d.clone().negate();
        if (n.dot(d) > 0) n.negate();
        const off = d.clone().addScaledVector(n, -2 * d.dot(n));
        const { ricochet, sparks } = armourConfig;
        const streaks: Streak[] = [
          { dir: off, speed: ricochet.speed, look: [ricochet.length, ricochet.width, ricochet.life, ricochet.white] },
        ];
        for (let i = 0; i < sparks.count; i++) {
          const dir = new THREE.Vector3().randomDirection().multiplyScalar(sparks.spread).add(off).normalize();
          if (dir.dot(n) < 0) dir.addScaledVector(n, -2 * dir.dot(n)); // off the face, not into them
          const speed = THREE.MathUtils.lerp(sparks.speed[0], sparks.speed[1], Math.random());
          streaks.push({ dir, speed, look: [sparks.length, sparks.width, sparks.life, 0] });
        }
        // one burst per npc: struck again, it starts over
        const again = state.bursts.findIndex((b) => b.npc === npc);
        if (again !== -1) state.bursts.splice(again, 1);
        state.bursts.push({ npc, at: at.clone(), streaks, startSecs: w.gameTime.now() });
        npc.anim.flinch?.(part, at, d); // absent on an instance from before hmr
        state.write();
        state.onTick(); // shown at once, even paused
      },
      onTick() {
        if (state.bursts.length === 0) return; // nearly always
        const now = w.gameTime.now();
        state.streaks.now.value = now;
        const kept = state.bursts.filter((b) => now - b.startSecs < burstSecs());
        if (kept.length < state.bursts.length) {
          state.bursts = kept;
          state.write();
        }
        w.r3f?.invalidate(); // one more frame once the last is gone
      },
      write() {
        const { streakFrom: from, streakDir: dir, streakLook: look } = state.streaks.data;
        let count = 0;
        for (const b of state.bursts) {
          for (const s of b.streaks) {
            if (count === MAX_ARMOUR_STREAKS) break;
            b.at.toArray(from, count * 4);
            from[count * 4 + 3] = b.startSecs;
            s.dir.toArray(dir, count * 4);
            dir[count * 4 + 3] = s.speed;
            look.set(s.look, count * 4);
            count++;
          }
        }
        const { mesh, attrs } = state.streaks;
        mesh.count = count;
        mesh.visible = count > 0; // else no draw call
        for (const key of streakAttrs) {
          attrs[key].clearUpdateRanges();
          attrs[key].addUpdateRange(0, count * 4);
          attrs[key].needsUpdate = true;
        }
      },
    }),
    { reset: { streaks: true, bursts: true } },
  );

  w.npcArmour = state;

  return <primitive object={state.streaks.mesh} />;
}

/**
 * The outward normal of the face of `npc`'s `part` the shot met, written to `out`: the face `at` lies on, else the one
 * a shot along `d` enters by, e.g. one aimed at its middle. `null` for no such part
 */
function faceNormalOf(npc: Npc, part: null | string, at: THREE.Vector3, d: THREE.Vector3, out: THREE.Vector3) {
  const found = bodyPart(npc, part);
  if (found === null) return null;
  const { bone, box } = found;
  bone.updateWorldMatrix(true, false);
  const half = box.getSize(tmpSize).multiplyScalar(0.5);
  tmpInverse.copy(bone.matrixWorld).invert();
  /** In the box, as a share of its half-size: `±1` on a face */
  const p = tmpLocal.copy(at).applyMatrix4(tmpInverse).sub(box.getCenter(tmpCentre)).divide(half);
  const onFace = largestOf(p);
  if (Math.abs(p.getComponent(onFace)) >= 0.9) return toWorld(out, onFace, Math.sign(p.getComponent(onFace)), bone);
  const way = tmpLocal.copy(d).transformDirection(tmpInverse).divide(half);
  const entered = largestOf(way);
  return toWorld(out, entered, -Math.sign(way.getComponent(entered)), bone);
}

/** Which of `v`'s axes is largest, either way */
const largestOf = (v: THREE.Vector3) =>
  [0, 1, 2].reduce((best, i) => (Math.abs(v.getComponent(i)) > Math.abs(v.getComponent(best)) ? i : best));

/** The unit `axis` of `bone`'s frame, `sign` its way, in the world */
const toWorld = (out: THREE.Vector3, axis: number, sign: number, bone: THREE.Bone) =>
  out.set(0, 0, 0).setComponent(axis, sign).transformDirection(bone.matrixWorld);

/** Seconds a burst lasts: its longest-lived streak's */
const burstSecs = () => Math.max(armourConfig.ricochet.life, armourConfig.sparks.life);

const tmpInverse = new THREE.Matrix4();
const tmpLocal = new THREE.Vector3();
const tmpCentre = new THREE.Vector3();
const tmpSize = new THREE.Vector3();

type Streak = {
  /** Unit, in the world */
  dir: THREE.Vector3;
  /** Metres a second it starts at */
  speed: number;
  /** Its length, width, life and whiteness */
  look: [number, number, number, number];
};

/** A shot armour took: it glancing off, and sparks, from where it met them */
type Burst = {
  npc: Npc;
  at: THREE.Vector3;
  streaks: Streak[];
  startSecs: number;
};

export type State = {
  /** Each until its last streak has faded */
  bursts: Burst[];
  streaks: ArmourStreaks;
  /** The shot from `from` glances off where it landed `at` on `npc`'s `part`, in a spray of sparks: they flinch */
  flash(npc: Npc, part: null | string, at: THREE.Vector3, from: THREE.Vector3): void;
  /** Now, for their ages: those faded are dropped */
  onTick(): void;
  /** Every burst's streaks, sending only those, as one starts or ends */
  write(): void;
};
