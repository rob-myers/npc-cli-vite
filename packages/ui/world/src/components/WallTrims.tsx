import { useStateRef } from "@npc-cli/util";
import { useContext, useEffect, useMemo } from "react";
import * as THREE from "three/webgpu";
import { wallHeight } from "../const";
import { createTwoSidedXyQuad } from "../service/geometry";
import { ensureRoomSlots } from "../service/room-slots";
import { bootstrapInstanceColor } from "../service/texture";
import { createWallBandMaterial, wallBandColor, wallBandHeight } from "../service/wall-band";
import { WorldContext } from "./world-context";

/**
 * The band every wall wears along the CEILING, a connector's own included. See `WallSkirts` for
 * its twin at the floor: the two differ only in where up the wall they sit.
 *
 * Placed with `Walls`' own `getWallMat` and slot writers, so a band cannot end up anywhere its
 * wall is not, nor be shown when that wall is hidden
 */
export default function WallTrims() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      inst: null,
      // its own, not shared with the walls: `roomSlots` lives on the GEOMETRY, so two meshes
      // sharing one could not stand in different rooms
      quad: createTwoSidedXyQuad(),

      positionInstances() {
        const { inst } = state;
        if (!inst) return;
        const slots = ensureRoomSlots(state.quad, getTrimCount(w));
        const color = new THREE.Color(wallBandColor);

        let id = 0;
        for (const [gmId, { key: gmKey, transform, determinant }] of w.gms.entries()) {
          for (const wallSeg of w.gmsData.byKey[gmKey].wallSegs) {
            const { seg, meta } = wallSeg;
            const wallH = typeof meta.h === "number" ? meta.h : wallHeight;
            const wallBase = typeof meta.y === "number" ? meta.y : 0;
            w.wall.setSegSlots(slots, id, gmId, wallSeg);
            inst.setMatrixAt(
              id,
              w.wall.getWallMat(seg, transform, determinant, wallBandHeight, wallBase + wallH - wallBandHeight),
            );
            inst.setColorAt(id++, color);
          }
          // a connector's own trim takes the connector's rooms, which it already knows. These two
          // walk exactly as `doorSegs` and `windowSegs` are built — one segment per door, but a
          // window's whole outline — since the instances are counted from those
          for (const { seg, roomIds } of w.gms[gmId].doors) {
            w.wall.setConnectorSlots(slots, id, gmId, roomIds);
            inst.setMatrixAt(
              id,
              w.wall.getWallMat(seg, transform, determinant, wallBandHeight, wallHeight - wallBandHeight),
            );
            inst.setColorAt(id++, color);
          }
          for (const { poly, roomIds } of w.gms[gmId].windows) {
            for (const seg of poly.lineSegs) {
              w.wall.setConnectorSlots(slots, id, gmId, roomIds);
              inst.setMatrixAt(
                id,
                w.wall.getWallMat(seg, transform, determinant, wallBandHeight, wallHeight - wallBandHeight),
              );
              inst.setColorAt(id++, color);
            }
          }
        }
        slots.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      },
    }),
  );

  const count = getTrimCount(w);

  // before the material below, which reads `roomSlots`: an attribute a shader names has to be on
  // the geometry by the time it compiles, and `positionInstances` only fills it in an effect
  useMemo(() => ensureRoomSlots(state.quad, count), [count]);

  const material = useMemo(() => createWallBandMaterial(w), [w.view.fadeRoomsFx.uid]);

  useEffect(() => {
    state.positionInstances();
  }, [w.mapKey, w.gmsHash, w.hash, w.decor.ready, material]);

  return count ? (
    <instancedMesh
      key={material.uuid}
      name="walls-along-ceiling"
      ref={state.ref("inst", bootstrapInstanceColor)}
      args={[state.quad, material, count]}
      renderOrder={4}
    />
  ) : null;
}

/** One band per wall segment, per door, and per segment of a window's outline */
export function getTrimCount(w: import("@npc-cli/util").UseStateRef<import("./World").State>) {
  return w.gmsData.count.wall + w.gmsData.count.door + w.gmsData.count.window;
}

export type State = {
  inst: null | THREE.InstancedMesh;
  /** Its own geometry — see `quad` in the state */
  quad: THREE.BufferGeometry;
  positionInstances: () => void;
};
