import { useStateRef } from "@npc-cli/util";
import { useContext, useEffect, useMemo } from "react";
import { attribute, cameraProjectionMatrix, cameraViewMatrix, float, select, texture, uv, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { MAX_ROOM_LABEL_INSTANCES, MAX_ROOM_LABELS, roomLabelHeight, roomLabelWidth, wallHeight } from "../const";
import { helper } from "../service/helper";
import { slotOf } from "../service/room-slots";
import type { SelectAnyType } from "../service/texture";
import { WorldContext } from "./world-context";

/**
 * What each room is called, as a billboard at its labelled decor point. Drawn over everything
 * (`depthTest: false`) so no obstacle can swallow a name — painting into the floor was tried
 * first, see `docs/FLOOR-LOOK.md`. One texture layer per DISTINCT text, not per room.
 */
export default function RoomLabels() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      res: createRoomLabelResources(),
      layerOfLabel: {},

      draw() {
        const { ct } = w.texRoomLabel;
        const { width, height } = ct.canvas;
        state.layerOfLabel = {};
        let layer = 0;

        for (const decor of Object.values(w.decor.byKey)) {
          if (helper.isRoomLabel(decor) === false) continue;
          const label = decor.meta.label;
          if (state.layerOfLabel[label] !== undefined) continue;
          if (layer >= MAX_ROOM_LABELS) break;

          ct.clearRect(0, 0, width, height);
          ct.textAlign = "center";
          ct.textBaseline = "alphabetic";
          ct.letterSpacing = "0.25em";
          let fontSize = roomLabelFontSize;
          ct.font = `300 ${fontSize}px sans-serif`;
          let m = ct.measureText(label);
          // the box the glyphs occupy, NOT the advance width: `letterSpacing` leaves a trailing
          // gap, and measuring on that sits the words left of centre
          const boxWidth = () => m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
          if (boxWidth() > width - roomLabelPadding * 2) {
            fontSize *= (width - roomLabelPadding * 2) / boxWidth(); // shrink to fit, not clip
            ct.font = `300 ${fontSize}px sans-serif`;
            m = ct.measureText(label);
          }

          // the plate hugs the words: the quad is the same size whatever it says, so a full-width
          // one would leave `office` adrift in a box built for `cartography`
          const glyphHeight = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
          const plateWidth = Math.min(width, boxWidth() + roomLabelPadding * 2);
          const plateHeight = Math.min(height, glyphHeight + roomLabelPaddingY * 2);
          ct.fillStyle = roomLabelPlateInk;
          ct.fillRect((width - plateWidth) / 2, (height - plateHeight) / 2, plateWidth, plateHeight);

          // centred on the glyphs, both ways — `middle` centres the em box, which sits off the
          // optical centre of a word with no descenders
          ct.fillStyle = roomLabelInk;
          ct.fillText(
            label,
            width / 2 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2,
            height / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2,
          );

          w.texRoomLabel.updateIndex(layer);
          state.layerOfLabel[label] = layer++;
        }
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
    }),
    { reset: { res: false } },
  );

  w.roomLabels = state;

  useMemo(() => {
    // captures `fade-rooms`' nodes, so it is rebuilt whenever that service is
    const { mat, inst, slot } = state.res;
    const fade = w.view.fadeRoomsFx.getVisiblity(slot).max(w.view.fadeRoomsFx.prodNode.oneMinus());

    const sign = attribute<"vec2">("billboardOffset", "vec2");
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
      tex.a.mul(w.view.foldNode).mul(fade),
    ) as THREE.Node<"float">;
    mat.colorNode = vec4(tex.rgb, alpha);
    mat.needsUpdate = true;
  }, [w.view.fadeRoomsFx.uid, w.texRoomLabel.hash]);

  useEffect(() => {
    // decor carries the labels AND the rooms they stand in, so there is nothing to show before it
    if (w.decor.ready === false) return;
    state.draw();
    state.position();
    w.update();
  }, [w.decor.ready, w.gmsHash, w.hash]);

  return <primitive object={state.res.mesh} />;
}

export type State = {
  res: ReturnType<typeof createRoomLabelResources>;
  /** Which texture layer holds each distinct label */
  layerOfLabel: Record<string, number>;
  /** Draw each distinct label once, into its own layer */
  draw(): void;
  /** Put a billboard at every labelled decor point */
  position(): void;
};

function createRoomLabelResources() {
  const geo = new THREE.InstancedBufferGeometry();
  // every vertex sits at the instance's own point; `billboardOffset` spreads them in view space
  geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  // biome-ignore format: aligned to the canvas the label is drawn on
  geo.setAttribute("uv", new THREE.Float32BufferAttribute([
    0, 1,
    1, 1,
    1, 0,
    0, 0,
  ], 2));
  // biome-ignore format: the quad's corners, in halves of its width and height
  geo.setAttribute("billboardOffset", new THREE.Float32BufferAttribute([
    -1, -1,
     1, -1,
     1,  1,
    -1,  1,
  ], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);

  // per instance: world `xyz`, then which layer of the texture array says its name
  const instData = new Float32Array(MAX_ROOM_LABEL_INSTANCES * 4);
  const instAttr = new THREE.InstancedBufferAttribute(instData, 4);
  geo.setAttribute("labelInstance", instAttr);
  // and the slot of the room it names, so it fades with it
  const slotData = new Float32Array(MAX_ROOM_LABEL_INSTANCES);
  const slotAttr = new THREE.InstancedBufferAttribute(slotData, 1);
  geo.setAttribute("labelSlot", slotAttr);
  geo.instanceCount = 0;

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false, // over the world: an obstacle must not swallow the name of a room
    side: THREE.DoubleSide,
    opacity: 1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; // the quads are built in the shader, so their bounds mean nothing
  mesh.renderOrder = 5;

  return {
    geo,
    mat,
    mesh,
    instData,
    instAttr,
    slotData,
    slotAttr,
    inst: attribute<"vec4">("labelInstance", "vec4"),
    slot: attribute<"float">("labelSlot", "float"),
  };
}

const roomLabelInk = "rgba(226, 236, 248, 0.92)";
/** The plate behind the words, so they read over a busy floor */
const roomLabelPlateInk = "rgba(0, 0, 0, 0.65)";
const roomLabelFontSize = 28;
/** Around the glyphs, in texture pixels — the plate is grown from what they measure */
const roomLabelPadding = 24;
const roomLabelPaddingY = 14;
/** Off the floor, so it is not in the floor's own plane */
const roomLabelLift = wallHeight;
