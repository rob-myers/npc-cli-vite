import { useStateRef } from "@npc-cli/util";
import { useContext, useEffect } from "react";
import { attribute, cameraProjectionMatrix, cameraViewMatrix, float, positionLocal, uv, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { MAX_NPCS, npcScale } from "../const";
import { createXzQuad } from "../service/geometry";
import { WorldContext } from "./world-context";

export default function NpcRings() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ...createSpawnRingResources(w.view.objectPick),
      spawnRingByNpc: new Map(),

      onTick(delta = 0) {
        for (const [npcKey, ring] of state.spawnRingByNpc) {
          if (ring.opacity !== ring.target) {
            const dir = Math.sign(ring.target - ring.opacity);
            const next = ring.opacity + dir * spawnRingFadeSpeed * delta;
            ring.opacity = dir > 0 ? Math.min(ring.target, next) : Math.max(ring.target, next);
          }
          if (ring.target === 0 && ring.opacity <= 0) {
            state.spawnRingByNpc.delete(npcKey);
          }
        }

        let j = 0;
        for (const ring of state.spawnRingByNpc.values()) {
          state.ringXzoData[j * 4] = ring.x;
          state.ringXzoData[j * 4 + 1] = ring.z;
          state.ringXzoData[j * 4 + 2] = ring.opacity;
          state.ringXzoData[j * 4 + 3] = ring.y;
          j++;
        }
        state.ringGeo.instanceCount = j;
        state.ringXzoAttr.needsUpdate = true;
      },
      showSpawnRing(npcKey, at, y = spawnRingDefaultHeight) {
        state.spawnRingByNpc.set(npcKey, { x: at.x, z: at.y, y, opacity: 1, target: 1 });
      },
      fadeOutSpawnRing(npcKey) {
        const ring = state.spawnRingByNpc.get(npcKey);
        if (ring) ring.target = 0;
      },
      removeSpawnRing(npcKey) {
        state.spawnRingByNpc.delete(npcKey);
      },
    }),
    {
      // rebuild geometry/material (e.g. shader tweaks) on HMR, instead of only on first mount
      reset: { ringGeo: true, ringMat: true, ringMesh: true, ringXzoData: true, ringXzoAttr: true },
    },
  );

  useEffect(() => {
    w.rings = state;
    return () => {
      state.ringGeo.dispose();
      state.ringMat.dispose();
    };
  }, []);

  return <primitive object={state.ringMesh} />;
}

export type State = {
  ringGeo: THREE.InstancedBufferGeometry;
  ringMat: THREE.MeshBasicNodeMaterial;
  ringMesh: THREE.Mesh;
  ringXzoData: Float32Array;
  ringXzoAttr: THREE.InstancedBufferAttribute;
  /** Per-npc spawn-destination ring shown during `fadeSpawn`, keyed by npcKey */
  spawnRingByNpc: Map<string, { x: number; z: number; y: number; opacity: number; target: number }>;
  onTick(delta?: number): void;
  /** Show ring at ground point `at` (`at.y` is world z) and world-height `y`, fully visible */
  showSpawnRing(npcKey: string, at: { x: number; y: number }, y?: number): void;
  /** Start fading the ring out; it is auto-removed once fully faded */
  fadeOutSpawnRing(npcKey: string): void;
  /** Remove the ring immediately e.g. on teleport failure */
  removeSpawnRing(npcKey: string): void;
};

/** Opacity units per second */
const spawnRingFadeSpeed = 2.5;
/** Default ring height when target isn't doable (just above floor, avoids z-fighting) */
const spawnRingDefaultHeight = 0.02;

function createSpawnRingResources(objectPick: THREE.UniformNode<"float", number>) {
  const base = createXzQuad();
  const pos = base.getAttribute("position") as THREE.BufferAttribute;
  const ringScale = npcScale * 1.6;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, (pos.getX(i) - 0.5) * ringScale);
    pos.setZ(i, (pos.getZ(i) - 0.5) * ringScale);
  }
  const ringGeo = new THREE.InstancedBufferGeometry();
  ringGeo.setAttribute("position", pos);
  ringGeo.setAttribute("uv", base.getAttribute("uv"));
  ringGeo.setIndex(base.getIndex());
  /** Per-instance `[x, z, opacity, y]` — `y` is world height (varies e.g. when target is doable) */
  const ringXzoData = new Float32Array(MAX_NPCS * 4);
  const ringXzoAttr = new THREE.InstancedBufferAttribute(ringXzoData, 4);
  ringGeo.setAttribute("ringXZO", ringXzoAttr);
  ringGeo.instanceCount = 0;

  const xzo = attribute<"vec4">("ringXZO", "vec4");
  const worldPos = vec4(positionLocal.x.add(xzo.x), xzo.w, positionLocal.z.add(xzo.y), 1.0);
  const clipPos = cameraProjectionMatrix.mul(cameraViewMatrix.mul(worldPos));
  const dist = uv().sub(0.5).length();
  // radius grows from ringRadius towards ringRadius + ringExpandAmount as opacity (xzo.z) fades out
  const expandedRadius = xzo.z.oneMinus().mul(ringExpandAmount).add(ringRadius);
  // annulus: 1 at expandedRadius, falling off to 0 across ringBandWidth on either side
  const band = float(1).sub(dist.sub(expandedRadius).abs().div(ringBandWidth).clamp(0, 1));
  const baseAlpha = band.mul(xzo.z).mul(0.28);
  const alpha = objectPick.notEqual(0).select(float(0), baseAlpha);

  const ringMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.FrontSide });
  ringMat.vertexNode = clipPos;
  ringMat.colorNode = vec4(0.4, 0.4, 0.4, alpha.mul(0.5));

  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.frustumCulled = false;

  return { ringGeo, ringMat, ringMesh, ringXzoData, ringXzoAttr };
}

const ringRadius = 0.16;
/** Additional radius gained by the time the ring has fully faded out */
const ringExpandAmount = 0.22;
const ringBandWidth = 0.035;
