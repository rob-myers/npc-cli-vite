import { useStateRef } from "@npc-cli/util";
import { useContext, useEffect } from "react";
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  float,
  max,
  positionLocal,
  select,
  uniform,
  vec2,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { MAX_NPCS, npcScale } from "../const";
import { createXzQuad } from "../service/geometry";
import type { SelectAnyType, SelectFloatType } from "../service/texture";
import { WorldContext } from "./world-context";

export default function NpcShadows() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      shadow: createShadowResources(w.view.objectPick, w.view.foldNode),
      onTick() {
        const { xzoData, xzoAttr, geo, light } = state.shadow;

        let i = 0;
        for (const npc of Object.values(w.n)) {
          xzoData[i * 3] = npc.position.x;
          xzoData[i * 3 + 1] = npc.position.z;
          xzoData[i * 3 + 2] = 1;
          i++;
        }
        geo.instanceCount = i;
        xzoAttr.needsUpdate = true;

        // (x, z, active, radius) of the npc-follow light
        const dl = w.view.dynamicLight;
        if (w.view.dynamicLightTarget !== null) {
          light.value.set(dl.displayCenter.x, dl.displayCenter.z, 1, dl.radius);
        } else {
          light.value.z = 0;
        }
      },
    }),
    { reset: { shadow: true } },
  );

  useEffect(() => {
    w.shadows = state;
    return () => {
      state.shadow.geo.dispose();
      state.shadow.mat.dispose();
    };
  }, []);

  return <primitive object={state.shadow.mesh} />;
}

export type State = {
  shadow: ReturnType<typeof createShadowResources>;
  onTick(): void;
};

/** How far (in radii) a shadow shifts away from the light at the edge of its radius */
const maxShadowOffset = 0.15;
const shadowRadius = npcScale / 2.5;

function createShadowResources(
  objectPick: THREE.UniformNode<"float", number>,
  fold: THREE.UniformNode<"float", number>,
) {
  const base = createXzQuad();
  const pos = base.getAttribute("position") as THREE.BufferAttribute;
  const quadSide = shadowRadius * 2 * (maxShadowOffset + 1); // room for the max offset, any direction
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, (pos.getX(i) - 0.5) * quadSide);
    pos.setZ(i, (pos.getZ(i) - 0.5) * quadSide);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", pos);
  geo.setAttribute("uv", base.getAttribute("uv"));
  geo.setIndex(base.getIndex());
  const xzoData = new Float32Array(MAX_NPCS * 3);
  const xzoAttr = new THREE.InstancedBufferAttribute(xzoData, 3);
  geo.setAttribute("shadowXZO", xzoAttr);
  geo.instanceCount = 0;

  const light = uniform(new THREE.Vector4(0, 0, 0, 1));
  const xzo = attribute<"vec3">("shadowXZO", "vec3");

  const worldPos = vec4(positionLocal.x.add(xzo.x), 0.01, positionLocal.z.add(xzo.y), 1.0);
  const clipPos = cameraProjectionMatrix.mul(cameraViewMatrix.mul(worldPos));

  // shift the shadow circle away from the light, farther near the edge of its radius
  const rel = vec2(xzo.x, xzo.y).sub(light.xy);
  const dist = rel.length();
  const proximity = light.z.mul(dist.div(max(light.w, 0.001)).clamp(0, 1));
  const offsetAmount = proximity.mul(maxShadowOffset).mul(shadowRadius);
  const offset = (select as SelectAnyType)(
    dist.greaterThan(0.05),
    rel.div(max(dist, 0.05)).mul(offsetAmount),
    vec2(0, 0),
  ) as THREE.Node<"vec2">;

  // plain circle, recentred at (npc + offset), solid out to (radius - edgeSoftness) then a thin fade
  const distToCenter = vec2(positionLocal.x, positionLocal.z).sub(offset).length();
  const edgeSoftness = shadowRadius * 0.2;
  const baseAlpha = float(1)
    .sub(distToCenter.sub(shadowRadius - edgeSoftness).div(edgeSoftness))
    .clamp(0, 1)
    .mul(0.4)
    .mul(xzo.z);
  const alpha = (select as SelectFloatType)(objectPick.notEqual(0), float(0), baseAlpha);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.FrontSide });
  mat.vertexNode = clipPos;
  // fades with the npc it belongs to whilst a map changes over — see `setWorldFold`
  mat.colorNode = vec4(0, 0, 0, alpha.mul(fold));

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;

  return { geo, mat, mesh, xzoData, xzoAttr, light };
}
