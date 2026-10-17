import { useStateRef } from "@npc-cli/util";
import { useContext } from "react";
import * as THREE from "three/webgpu";
import { hitConfig, shieldConfig } from "../const.npc";
import { bodyPart } from "../service/phaser-beam";
import {
  createShieldPieces,
  MAX_SHIELD_PIECES,
  type PieceKind,
  pieceKinds,
  type ShieldPiece,
} from "../service/shield-pieces";
import type { Npc } from "./npc";
import { WorldContext } from "./world-context";

/** Personal shields: struck, the piece over the part hit lights from the hit, then dissolves — see `docs/engagements.md` */
export default function NpcShields() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      flashes: [],
      pieces: createShieldPieces(w.view.objectPick),
      shown: false,

      flash(npc, part, from) {
        const found = bodyPart(npc, part);
        if (found === null) return null;
        const { bone, box } = found;
        const kind: PieceKind = hitConfig.region[bone.name] === "head" ? "helmet" : "band";
        let local = localByBox.get(box);
        if (local === undefined) localByBox.set(box, (local = pieceMatrix(kind, box)));
        bone.updateWorldMatrix(true, false);
        const world = tmpWorld.multiplyMatrices(bone.matrixWorld, local);
        // on the unit piece, the way the shot came
        const p = tmpFrom.copy(from).applyMatrix4(tmpInverse.copy(world).invert());
        const hit = new THREE.Vector3(p.x, kind === "helmet" ? Math.max(p.y, 0) : 0, p.z);
        if (hit.lengthSq() < 1e-6) hit.set(0, 0, 0.5);
        else hit.setLength(0.5);
        // one flash per piece: struck again, it starts over
        const again = state.flashes.findIndex((f) => f.npc === npc && f.bone === bone);
        if (again !== -1) state.flashes.splice(again, 1);
        state.flashes.push({ npc, kind, bone, local, hit, startSecs: w.timer.getElapsedTime() });
        state.onTick(); // shown at once, even paused
        return tmpSurface.copy(hit).applyMatrix4(world);
      },
      onTick() {
        if (state.flashes.length === 0 && state.shown === false) return; // nearly always
        const now = w.timer.getElapsedTime();
        const { flashes, pieces } = state;
        let kept = 0;
        let helmets = 0;
        let bands = 0;
        for (const f of flashes) {
          if (now - f.startSecs >= shieldConfig.endSecs || w.n[f.npc.key] !== f.npc) continue; // dissolved, or gone
          flashes[kept++] = f; // kept in place, so no array is made each tick
          const i = f.kind === "helmet" ? helmets++ : bands++;
          if (i >= MAX_SHIELD_PIECES) continue;
          const { mesh, hitData } = pieces[f.kind];
          f.bone.updateWorldMatrix(true, false); // this frame's, which the render has yet to work out
          mesh.setMatrixAt(i, tmpWorld.multiplyMatrices(f.bone.matrixWorld, f.local));
          f.hit.toArray(hitData, i * 4);
          hitData[i * 4 + 3] = now - f.startSecs;
        }
        flashes.length = kept;
        showPieces(pieces.helmet, Math.min(helmets, MAX_SHIELD_PIECES));
        showPieces(pieces.band, Math.min(bands, MAX_SHIELD_PIECES));
        state.shown = state.flashes.length > 0;
        w.r3f?.invalidate(); // one more frame once the last is gone
      },
    }),
    { reset: { pieces: true } },
  );

  w.npcShields = state;

  return (
    <>
      {pieceKinds.map((kind) => (
        <primitive key={kind} object={state.pieces[kind].mesh} />
      ))}
    </>
  );
}

/** Draws the first `count` of `piece`, sending only those */
function showPieces({ mesh, hitAttr }: ShieldPiece, count: number) {
  mesh.count = count;
  mesh.visible = count > 0; // else no draw call
  if (count === 0) return;
  mesh.instanceMatrix.clearUpdateRanges();
  mesh.instanceMatrix.addUpdateRange(0, count * 16);
  mesh.instanceMatrix.needsUpdate = true;
  hitAttr.clearUpdateRanges();
  hitAttr.addUpdateRange(0, count * 4);
  hitAttr.needsUpdate = true;
}

/** Each part's piece in its bone's frame: a box is one bone's on one rig, so its piece never changes */
const localByBox = new WeakMap<THREE.Box3, THREE.Matrix4>();

/**
 * A unit piece's place in its bone's frame, round the box of what that bone moves. A band runs along the bone's `y`:
 * up the body, or along a limb. The torso's parts are wider than they are tall
 */
function pieceMatrix(kind: PieceKind, box: THREE.Box3) {
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const { girth, length } = shieldConfig.band;
  if (kind === "helmet") size.multiplyScalar(shieldConfig.helmet);
  else size.multiply(tmpScale.set(girth, length, girth));
  return new THREE.Matrix4().compose(centre, noTurn, size);
}

const noTurn = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpWorld = new THREE.Matrix4();
const tmpInverse = new THREE.Matrix4();
const tmpFrom = new THREE.Vector3();
const tmpSurface = new THREE.Vector3();

type Flash = {
  npc: Npc;
  kind: PieceKind;
  bone: THREE.Bone;
  /** The piece in its bone's frame — see `pieceMatrix` */
  local: THREE.Matrix4;
  /** Where it was hit, on the unit piece */
  hit: THREE.Vector3;
  startSecs: number;
};

export type State = {
  /** The pieces lit, until each has dissolved */
  flashes: Flash[];
  pieces: Record<PieceKind, ShieldPiece>;
  /** Some piece was drawn last tick */
  shown: boolean;
  /** Lights the piece over `npc`'s `part`, struck from `from`. Returns where it was struck, else `null` for no such part */
  flash(npc: Npc, part: null | string, from: THREE.Vector3): null | THREE.Vector3;
  /** Every piece lit, on its bone — after the npcs' own tick has posed them */
  onTick(): void;
};
