import { useStateRef } from "@npc-cli/util";
import { useContext, useMemo } from "react";
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  float,
  positionLocal,
  select,
  vec2,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { MAX_NPCS, npcShadowRadius } from "../const";
import { createXzQuad } from "../service/geometry";
import type { SelectFloatType } from "../service/texture";
import { WorldContext } from "./world-context";

export default function NpcShadows() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      shadow: createShadowResources(w.view.objectPick, w.view.foldNode),
      onTick() {
        const { xzoData, xzoAttr, geo, mesh } = state.shadow;

        let i = 0;
        for (const npc of Object.values(w.n)) {
          // one `prod` has wiped away casts nothing, so they take their instance with them
          if (npc.hidden === true) continue;
          xzoData[i * 4] = npc.position.x;
          xzoData[i * 4 + 1] = npc.position.z;
          xzoData[i * 4 + 2] = 1;
          // a shadow goes where the npc casting it goes, faded room and all
          xzoData[i * 4 + 3] = npc.roomSlot.value;
          i++;
        }
        geo.instanceCount = i;
        mesh.visible = i > 0; // nobody to shade: no draw call at all
        xzoAttr.needsUpdate = true;
      },
    }),
    { reset: { shadow: false } },
  );

  w.shadows = state;

  useMemo(() => {
    // the same fade the npc casting it reads, so the two keep step — except in `dev`, where the npc
    // stays blacked out rather than going, and a shadowless figure reads as floating
    const fade = w.view.fadeRoomsFx.getVisiblity(state.shadow.xzo.w).max(w.view.fadeRoomsFx.prodNode.oneMinus());
    const { vertexNode, colorNode } = shadowNodes(state.shadow, fade);
    state.shadow.mat.vertexNode = vertexNode;
    state.shadow.mat.colorNode = colorNode;
    state.shadow.mat.needsUpdate = true;
  }, [w.view.fadeRoomsFx.uid]);

  return <primitive object={state.shadow.mesh} />;
}

export type State = {
  shadow: ReturnType<typeof createShadowResources>;
  onTick(): void;
};

function createShadowResources(
  objectPick: THREE.UniformNode<"float", number>,
  fold: THREE.UniformNode<"float", number>,
) {
  const base = createXzQuad();
  const pos = base.getAttribute("position") as THREE.BufferAttribute;
  const quadSide = npcShadowRadius * 2;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, (pos.getX(i) - 0.5) * quadSide);
    pos.setZ(i, (pos.getZ(i) - 0.5) * quadSide);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", pos);
  geo.setAttribute("uv", base.getAttribute("uv"));
  geo.setIndex(base.getIndex());
  // per instance: world `xz`, an opacity, then the slot of the room its npc stands in
  const xzoData = new Float32Array(MAX_NPCS * 4);
  const xzoAttr = new THREE.InstancedBufferAttribute(xzoData, 4);
  geo.setAttribute("shadowXZO", xzoAttr);
  geo.instanceCount = 0;

  const xzo = attribute<"vec4">("shadowXZO", "vec4");

  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.FrontSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;

  return { geo, mat, mesh, xzoData, xzoAttr, xzo, objectPick, fold };
}

/**
 * What the shadow draws, given how much of its npc's room is shown — it simply goes with them.
 *
 * Rebuilt whenever `fade-rooms` is, since it captures that service's nodes — hence a function
 * rather than something settled once with the geometry
 */
function shadowNodes(shadow: ReturnType<typeof createShadowResources>, fade: THREE.Node<"float">) {
  const { xzo, objectPick, fold } = shadow;
  const worldPos = vec4(positionLocal.x.add(xzo.x), 0.01, positionLocal.z.add(xzo.y), 1.0);

  // plain circle, solid out to (radius - edgeSoftness) then a thin fade
  const distToCenter = vec2(positionLocal.x, positionLocal.z).length();
  const edgeSoftness = npcShadowRadius * 0.2;
  const baseAlpha = float(1)
    .sub(distToCenter.sub(npcShadowRadius - edgeSoftness).div(edgeSoftness))
    .clamp(0, 1)
    .mul(0.4)
    .mul(xzo.z);
  const alpha = (select as SelectFloatType)(objectPick.notEqual(0), float(0), baseAlpha);

  return {
    vertexNode: cameraProjectionMatrix.mul(cameraViewMatrix.mul(worldPos)),
    colorNode: vec4(0, 0, 0, alpha.mul(fold).mul(fade)),
  };
}
