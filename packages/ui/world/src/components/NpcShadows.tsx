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
        const { xzoData, xzoAttr, geo } = state.shadow;

        let i = 0;
        for (const npc of Object.values(w.n)) {
          xzoData[i * 4] = npc.position.x;
          xzoData[i * 4 + 1] = npc.position.z;
          xzoData[i * 4 + 2] = 1;
          // a shadow goes where the npc casting it goes, faded room and all
          xzoData[i * 4 + 3] = npc.roomSlot.value;
          i++;
        }
        geo.instanceCount = i;
        xzoAttr.needsUpdate = true;
      },
    }),
    { reset: { shadow: false } },
  );

  w.shadows = state;

  useMemo(() => {
    state.shadow.mat.colorNode = state.shadow.colorNode.mul(w.view.fadeRoomsFx.getVisiblity(state.shadow.xzo.w));
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

  const worldPos = vec4(positionLocal.x.add(xzo.x), 0.01, positionLocal.z.add(xzo.y), 1.0);
  const clipPos = cameraProjectionMatrix.mul(cameraViewMatrix.mul(worldPos));

  // plain circle, solid out to (radius - edgeSoftness) then a thin fade
  const distToCenter = vec2(positionLocal.x, positionLocal.z).length();
  const edgeSoftness = npcShadowRadius * 0.2;
  const baseAlpha = float(1)
    .sub(distToCenter.sub(npcShadowRadius - edgeSoftness).div(edgeSoftness))
    .clamp(0, 1)
    .mul(0.4)
    .mul(xzo.z);
  const alpha = (select as SelectFloatType)(objectPick.notEqual(0), float(0), baseAlpha);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.FrontSide });
  mat.vertexNode = clipPos;

  const colorNode = vec4(0, 0, 0, alpha.mul(fold));

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;

  return { geo, mat, mesh, xzoData, xzoAttr, colorNode, xzo };
}
