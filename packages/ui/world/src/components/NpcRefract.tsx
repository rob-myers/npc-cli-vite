import { useStateRef } from "@npc-cli/util";
import { useContext } from "react";
import * as THREE from "three/webgpu";
import { refractConfig } from "../const.npc";
import { createRefracts, MAX_REFRACTS, type Refracts } from "../service/refract";
import type { AnimationClipKey } from "./NPCs";
import type { Npc } from "./npc";
import { WorldContext } from "./world-context";

/** Refract: they turn to psi and look to the shot, and a psi beam from a band floating round their head stops it — see `docs/engagements.md` */
export default function NpcRefract() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      byNpc: new Map(),
      meshes: createRefracts(w.view.objectPick),

      onTick() {
        const { beams, bands, flares, beamAlphas, bandAlphas, flareAt, uploads } = state.meshes;
        if (state.byNpc.size === 0 && beams.visible === false) return; // nearly always
        const now = w.gameTime.now();
        const { reachSecs, holdSecs, outSecs, flareSecs, band } = refractConfig;
        const bob = band.y + band.bob * Math.sin(now * band.bobHz * 2 * Math.PI);
        bandLocal.makeScale(band.radius, band.radius, band.radius).setPosition(0, bob, 0);
        let count = 0;
        for (const [npcKey, ward] of state.byNpc) {
          const { startSecs, struckSecs, look } = ward;
          /** Fading from the strike, as the shot does, else once held long enough unstruck */
          const fade = Math.min(1, 1 - (now - (struckSecs ?? startSecs + reachSecs + holdSecs)) / outSecs);
          const head = ward.npc.anim.upperHead.entry?.bone;
          if (fade <= 0 || head === undefined) {
            state.byNpc.delete(npcKey);
            state.release(ward);
            continue;
          }
          if (count === MAX_REFRACTS) continue; // not drawn
          const reach = Math.min(1, (now - startSecs) / reachSecs);
          head.updateWorldMatrix(true, false);
          bands.setMatrixAt(count, tmpMatrix.multiplyMatrices(head.matrixWorld, bandLocal));
          bandAlphas.setX(count, fade * Math.min(1, (now - startSecs) / band.inSecs));
          // from the band, where it faces their psi's mark
          const local = head.worldToLocal(tmpFrom.copy(look.at));
          const angle = Math.atan2(local.x, local.z);
          tmpFrom.set(band.radius * Math.sin(angle), bob, band.radius * Math.cos(angle));
          beams.setMatrixAt(count, beamMatrix(head.localToWorld(tmpFrom), look.at, reach));
          beamAlphas.setX(count, fade);
          const flare = struckSecs === null ? 0 : Math.exp((struckSecs - now) / flareSecs);
          flareAt.setXYZW(count++, look.at.x, look.at.y, look.at.z, reach === 1 ? (0.4 + flare) * fade : 0);
        }
        beams.count = bands.count = flares.count = count;
        beams.visible = bands.visible = flares.visible = count > 0; // else no draw call
        for (const attr of uploads) {
          attr.clearUpdateRanges();
          attr.addUpdateRange(0, count * attr.itemSize);
          attr.needsUpdate = true;
        }
        w.r3f?.invalidate(); // one more frame once the last is gone
      },
      release({ npc, before, look }) {
        const { anim } = npc;
        if (anim.headAt === look) anim.headAt = null;
        // psi as it was, unless another has their hand since
        if (before !== "psi" && anim.upperLeft.key === "psi") anim.setUpper(before, { side: "left" });
      },
      stopAt(npc, out) {
        const ward = state.byNpc.get(npc.key);
        return ward === undefined ? null : out.copy(ward.look.at); // where their psi meets it
      },
      struck(npc, out) {
        const ward = state.byNpc.get(npc.key);
        if (ward === undefined) return null;
        ward.struckSecs = w.gameTime.now();
        state.onTick(); // shown at once, even paused
        return out.copy(ward.look.at);
      },
      ward(npc, from, at) {
        const was = state.byNpc.get(npc.key);
        // fired again before it fades: where it met it, still on the shot's line
        if (
          was !== undefined &&
          tmpRay.set(from, tmpDir.subVectors(at, from).normalize()).distanceToPoint(was.look.at) < refractConfig.keepM
        ) {
          was.struckSecs = w.gameTime.now(); // held on, until this one strikes it
          return;
        }
        const back = new THREE.Vector3().subVectors(from, at);
        const run = back.length();
        const { standoffM, reachShare, towardShooter } = refractConfig;
        const furthest = run * reachShare;
        if (furthest < standoffM) return; // too close to meet it
        const standoff = THREE.MathUtils.lerp(standoffM, furthest, 1 - (1 - Math.random()) ** towardShooter);
        const met = at.clone().addScaledVector(back.divideScalar(run), standoff);
        const { anim } = npc;
        if (anim.upperHead.entry === null) return; // no skeleton yet
        const before = was?.before ?? (anim.upperLeft.target === 1 ? anim.upperLeft.key : null);
        if (anim.upperLeft.key !== "psi") anim.setUpper("psi", { side: "left", past: true, onHead: true });
        const look = { at: met };
        anim.headAt = look;
        state.byNpc.set(npc.key, {
          npc,
          before,
          look,
          startSecs: w.gameTime.now(),
          struckSecs: null,
        });
        state.onTick(); // shown at once, even paused
      },
    }),
    { reset: { byNpc: true, meshes: true } },
  );

  w.npcRefract = state;

  return (
    <>
      <primitive object={state.meshes.beams} />
      <primitive object={state.meshes.bands} />
      <primitive object={state.meshes.flares} />
    </>
  );
}

/** A tube `width` across from `from`, `reach` of the way to `to` */
function beamMatrix(from: THREE.Vector3, to: THREE.Vector3, reach: number) {
  const along = tmpAlong.subVectors(to, from).multiplyScalar(reach);
  const length = Math.max(along.length(), 1e-3);
  tmpQuat.setFromUnitVectors(unitY, along.divideScalar(length));
  const radius = refractConfig.width / 2;
  return tmpMatrix.compose(from, tmpQuat, tmpScale.set(radius, length, radius));
}

/** The band in the head bone's frame, bobbing: rewritten each tick */
const bandLocal = new THREE.Matrix4();

const unitY = new THREE.Vector3(0, 1, 0);
const tmpRay = new THREE.Ray();
const tmpDir = new THREE.Vector3();
const tmpFrom = new THREE.Vector3();
const tmpAlong = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpMatrix = new THREE.Matrix4();

/** Their psi meeting a shot at them */
type Ward = {
  npc: Npc;
  /** What their left arm had before psi */
  before: null | AnimationClipKey;
  /** Their head's look at where their psi meets the shot's line, before them: ours to let go of */
  look: { at: THREE.Vector3 };
  startSecs: number;
  struckSecs: null | number;
};

export type State = {
  /** Each until it fades */
  byNpc: Map<string, Ward>;
  meshes: Refracts;
  /** Each ward a tick further on */
  onTick(): void;
  /** Their head and hand back as they were */
  release(ward: Ward): void;
  /** Where a shot at `npc` meets their psi, written to `out`: `null` for none */
  stopAt(npc: Npc, out: THREE.Vector3): null | THREE.Vector3;
  /** A shot at `npc` reaches their psi: it flares there. Where, else `null` */
  struck(npc: Npc, out: THREE.Vector3): null | THREE.Vector3;
  /** A shot from `from` at `at` they refract: they turn to psi, look to its line, and beam it there */
  ward(npc: Npc, from: THREE.Vector3, at: THREE.Vector3): void;
};
