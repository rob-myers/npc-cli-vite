import { useStateRef } from "@npc-cli/util";
import { useContext, useEffect, useMemo } from "react";
import { cameraProjectionMatrix, cameraViewMatrix, float, select, texture, uv, vec4 } from "three/tsl";
import type * as THREE from "three/webgpu";
import { MAX_ROOM_LABELS, roomLabelTexOpts } from "../const.env";
import { createLabelResources, drawLabel } from "../service/labels";
import { alwaysShownSlot, slotOf } from "../service/room-slots";
import { TexArray } from "../service/tex-array";
import type { SelectAnyType } from "../service/texture";
import { WorldContext } from "./world-context";

/**
 * Keyed text at a point, e.g. a decor's name whilst decorating: billboards over the world like
 * `RoomLabels` but occluded like any thing, one texture layer per DISTINCT text, never pickable,
 * fading with the room they are in — the label says which; one in no room is always shown
 */
export default function Labels() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      byKey: new Map(),
      res: createLabelResources(maxLabels, { occluded: true }),
      tex: new TexArray({ ...roomLabelTexOpts, ctKey: "labels" }),
      layerOfText: {},
      dirty: false,

      add(key, label) {
        state.byKey.set(key, label);
        state.queueRedraw();
      },
      remove(...keys) {
        let removed = false;
        for (const key of keys) removed = state.byKey.delete(key) || removed;
        if (removed) state.queueRedraw();
      },
      queueRedraw() {
        if (state.dirty === true) return;
        state.dirty = true;
        queueMicrotask(() => {
          state.dirty = false;
          state.redraw();
        });
      },
      redraw(retry = true) {
        const { instData, instAttr, slotData, slotAttr, geo, mesh } = state.res;
        let i = 0;
        for (const { x, y, y3d = 0, text, gmRoomId } of state.byKey.values()) {
          if (i >= maxLabels) break;
          const layer = state.layerOf(text);
          if (layer === null) {
            if (retry === false) break;
            state.layerOfText = {}; // full of texts gone by: once more from empty
            return state.redraw(false);
          }
          instData.set([x, y3d + labelLift, y, layer], i * 4);
          slotData[i] = gmRoomId === undefined ? alwaysShownSlot : slotOf(gmRoomId.gmId, gmRoomId.roomId);
          i++;
        }
        geo.instanceCount = i;
        mesh.visible = i > 0;
        instAttr.needsUpdate = true;
        slotAttr.needsUpdate = true;
        w.view.forceUpdate();
      },
      layerOf(text) {
        let layer = state.layerOfText[text];
        if (layer !== undefined) return layer;
        layer = Object.keys(state.layerOfText).length;
        if (layer >= MAX_ROOM_LABELS) return null;
        drawLabel(state.tex.ct, text);
        state.tex.updateIndex(layer);
        return (state.layerOfText[text] = layer);
      },
    }),
    { reset: { res: false, tex: false } },
  );

  w.labels = state;

  useMemo(() => {
    // captures `fade-rooms`' nodes, so it is rebuilt whenever that service is
    const { mat, inst, sign, slot } = state.res;
    const fade = w.view.fadeRoomsFx.getVisiblity(slot).max(w.view.fadeRoomsFx.sightNode.oneMinus());
    // billboarded in view space, as `RoomLabels` are
    const viewCentre = cameraViewMatrix.mul(vec4(inst.x, inst.y, inst.z, 1));
    mat.vertexNode = cameraProjectionMatrix.mul(
      viewCentre.add(vec4(sign.x.mul(labelWidth / 2), sign.y.mul(labelHeight / 2), 0, 0)),
    );
    const tex = texture(state.tex.tex, uv()).depth(inst.w.toInt());
    const alpha = (select as SelectAnyType)(
      w.view.objectPick.notEqual(0),
      float(0), // an annotation, never a thing to pick
      tex.a.mul(w.view.foldNode).mul(fade),
    ) as THREE.Node<"float">;
    mat.colorNode = vec4(tex.rgb, alpha);
  }, [state.tex.hash, w.view.fadeRoomsFx.uid]);

  useEffect(() => () => state.tex.dispose(), []);

  return <primitive object={state.res.mesh} />;
}

export type Label = {
  x: number;
  y: number;
  /** Height off the floor */
  y3d?: number;
  text: string;
  /** The room it fades with; none, and it is always shown */
  gmRoomId?: Geomorph.GmRoomId;
};

export type State = {
  byKey: Map<string, Label>;
  res: ReturnType<typeof createLabelResources>;
  tex: TexArray;
  /** Which texture layer holds each distinct text */
  layerOfText: Record<string, number>;
  /** A redraw is queued */
  dirty: boolean;
  /** Add, or replace what the key showed */
  add(key: string, label: Label): void;
  remove(...keys: string[]): void;
  /** One redraw for every add and remove this tick */
  queueRedraw(): void;
  /** Place every label; `retry` once with the layers cleared, should they be full */
  redraw(retry?: boolean): void;
  /** The text's layer, drawn if new; `null` when every layer is taken */
  layerOf(text: string): number | null;
};

const maxLabels = 256;
/** In metres, at the texture's 4:1 */
const labelWidth = 0.8;
const labelHeight = 0.2;
const labelLift = 0.35;
