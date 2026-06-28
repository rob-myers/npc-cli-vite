import { useStateRef } from "@npc-cli/util";
import { useContext, useEffect } from "react";
import { attribute, cameraProjectionMatrix, cameraViewMatrix, float, positionLocal, uv, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { MAX_NPCS, npcScale } from "../const";
import { createXzQuad } from "../service/geometry";
import { WorldContext } from "./world-context";

export default function NpcShadows() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ...createShadowResources(w.view.objectPick),
      onTick() {
        let i = 0;
        for (const npc of Object.values(w.n)) {
          state.xzoData[i * 3] = npc.position.x;
          state.xzoData[i * 3 + 1] = npc.position.z;
          state.xzoData[i * 3 + 2] = npc.opacityScale.value;
          i++;
        }
        state.geo.instanceCount = i;
        state.xzoAttr.needsUpdate = true;
      },
    }),
  );

  useEffect(() => {
    w.shadows = state;
    return () => {
      state.geo.dispose();
      state.mat.dispose();
    };
  }, []);

  return <primitive object={state.mesh} />;
}

export type State = {
  geo: THREE.InstancedBufferGeometry;
  mat: THREE.MeshBasicNodeMaterial;
  mesh: THREE.Mesh;
  xzoData: Float32Array;
  xzoAttr: THREE.InstancedBufferAttribute;
  onTick(): void;
};

function createShadowResources(objectPick: THREE.UniformNode<"float", number>) {
  const base = createXzQuad();
  const pos = base.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, (pos.getX(i) - 0.5) * npcScale);
    pos.setZ(i, (pos.getZ(i) - 0.5) * npcScale);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", pos);
  geo.setAttribute("uv", base.getAttribute("uv"));
  geo.setIndex(base.getIndex());
  const xzoData = new Float32Array(MAX_NPCS * 3);
  const xzoAttr = new THREE.InstancedBufferAttribute(xzoData, 3);
  geo.setAttribute("shadowXZO", xzoAttr);
  geo.instanceCount = 0;

  const xzo = attribute<"vec3">("shadowXZO", "vec3");
  const worldPos = vec4(positionLocal.x.add(xzo.x), 0.01, positionLocal.z.add(xzo.y), 1.0);
  const clipPos = cameraProjectionMatrix.mul(cameraViewMatrix.mul(worldPos));
  const center = uv().sub(0.5);
  const baseAlpha = float(1).sub(center.dot(center).mul(4)).clamp(0, 1).mul(0.6).mul(xzo.z);
  const alpha = objectPick.notEqual(0).select(float(0), baseAlpha);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.FrontSide });
  mat.vertexNode = clipPos;
  mat.colorNode = vec4(0, 0, 0, alpha);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;

  return { geo, mat, mesh, xzoData, xzoAttr };
}
