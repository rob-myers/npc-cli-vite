import { useStateRef } from "@npc-cli/util";
import { useContext, useEffect, useMemo } from "react";
import { cameraProjectionMatrix, cameraViewMatrix, float, mrt, select, texture, uv, vec4 } from "three/tsl";
import type * as THREE from "three/webgpu";
import { MAX_ROOM_LABEL_INSTANCES, MAX_ROOM_LABELS, roomLabelHeight, roomLabelWidth, wallHeight } from "../const.env";
import { helper } from "../service/helper";
import { createLabelResources, drawLabel } from "../service/labels";
import { slotOf } from "../service/room-slots";
import type { SelectAnyType } from "../service/texture";
import { WorldContext } from "./world-context";

/**
 * What each room is called, as a billboard at its labelled decor point. Drawn over everything
 * (`depthTest: false`) so no obstacle can swallow a name — painting into the floor was tried
 * first, see `docs/floor.md`. One texture layer per DISTINCT text, not per room.
 */
export default function RoomLabels() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      res: createLabelResources(),
      layerOfLabel: {},
      maskMrt: null,

      draw() {
        state.layerOfLabel = {};
        let layer = 0;

        for (const decor of Object.values(w.decor.byKey)) {
          if (helper.isRoomLabel(decor) === false) continue;
          const label = decor.meta.label;
          if (state.layerOfLabel[label] !== undefined) continue;
          if (layer >= MAX_ROOM_LABELS) break;

          drawLabel(w.texRoomLabel.ct, label);
          w.texRoomLabel.updateIndex(layer);
          state.layerOfLabel[label] = layer++;
        }
      },
      syncOutlineMask() {
        const { mat } = state.res;
        mat.mrtNode = w.view.npcMaskMrt === null || state.maskMrt === null ? null : state.maskMrt;
        mat.needsUpdate = true;
      },
      position() {
        const { instData, instAttr, slotData, slotAttr, geo, mesh } = state.res;

        let i = 0;
        for (const decor of Object.values(w.decor.byKey)) {
          if (helper.isRoomLabel(decor) === false) continue;
          const layer = state.layerOfLabel[decor.meta.label];
          if (layer === undefined) continue;
          if (i >= MAX_ROOM_LABEL_INSTANCES) break;

          instData[i * 4] = decor.x;
          instData[i * 4 + 1] = (decor.meta.y ?? 0) + roomLabelLift;
          instData[i * 4 + 2] = decor.y;
          instData[i * 4 + 3] = layer;
          slotData[i] = slotOf(decor.meta.gmId, decor.meta.roomId); // fades with its room
          i++;
        }

        geo.instanceCount = i;
        mesh.visible = i > 0; // nothing labelled: no draw call at all
        instAttr.needsUpdate = true;
        slotAttr.needsUpdate = true;
      },
      redraw() {
        // decor carries the labels AND the rooms they stand in, so there is nothing to show before it
        if (w.decor.ready === false) return;
        state.draw();
        state.position();
        w.update();
      },
    }),
    { reset: { res: false } },
  );

  w.roomLabels = state;

  useMemo(() => {
    // captures `fade-rooms`' nodes, so it is rebuilt whenever that service is
    const { mat, inst, slot, sign } = state.res;
    // `sense` keeps a hidden room's label, dimmed to tell it from a shown room's
    const fade = w.view.fadeRoomsFx
      .getVisiblity(slot)
      .max(w.view.fadeRoomsFx.sightNode.oneMinus().mul(hiddenRoomLabelFade));

    // billboarded in VIEW space: the quad is built about the point after the camera transform, so
    // it always faces us — flat to the floor from birdseye, upright as the view tilts in
    const viewCentre = cameraViewMatrix.mul(vec4(inst.x, inst.y, inst.z, 1));
    mat.vertexNode = cameraProjectionMatrix.mul(
      viewCentre.add(vec4(sign.x.mul(roomLabelWidth / 2), sign.y.mul(roomLabelHeight / 2), 0, 0)),
    );

    const tex = texture(w.texRoomLabel.tex, uv()).depth(inst.w.toInt());
    const alpha = (select as SelectAnyType)(
      w.view.objectPick.notEqual(0),
      float(0), // never pickable: it is an annotation, not a thing in the world
      tex.a.mul(w.view.foldNode).mul(w.view.labelReveal).mul(w.view.labelZoomFade).mul(fade),
    ) as THREE.Node<"float">;
    mat.colorNode = vec4(tex.rgb, alpha);
    // a name is drawn OVER the world, so the border round an npc must not creep onto it: the label
    // marks itself a caption in `npcMask.g`, by however much of it is there — see `npc-outline`
    state.maskMrt = mrt({ npcMask: vec4(0, 1, 0, alpha) });
    state.syncOutlineMask();
  }, [w.view.fadeRoomsFx.uid, w.texRoomLabel.hash]);

  useEffect(() => {
    // every rebuild renames the rooms, and `ready` need not have toggled across one
    state.redraw(); // decor may already be built, e.g. mounting after it, or on HMR
    const sub = w.events.subscribe({ next: (e) => e.key === "decor-ready" && state.redraw() });
    return () => sub.unsubscribe();
  }, [w.gmsHash, w.hash]);

  return <primitive object={state.res.mesh} />;
}

export type State = {
  res: ReturnType<typeof createLabelResources>;
  /** Which texture layer holds each distinct label */
  layerOfLabel: Record<string, number>;
  /** Marks the label a caption the npc border may not paint over, whilst those borders run */
  maskMrt: null | THREE.MRTNode;
  /** Keeps `mrtNode` in step with `w.view.npcMaskMrt` — see `NPCs.syncOutlineMask` */
  syncOutlineMask(): void;
  /** Draw each distinct label once, into its own layer */
  draw(): void;
  /** Put a billboard at every labelled decor point */
  position(): void;
  /** Draw and place the labels, once decor is built */
  redraw(): void;
};

/** Off the floor, so it is not in the floor's own plane */
const roomLabelLift = wallHeight;
/** How much of a hidden room's label `sense` mode shows */
const hiddenRoomLabelFade = 0.25;
