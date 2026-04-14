import { url } from "@npc-cli/media";
import { useStateRef } from "@npc-cli/util";
import { getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { buildGraph, useFrame } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import React, { useMemo } from "react";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cameraPosition, normalWorld, positionWorld, texture as tslTexture, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { createSkinnedXzQuad, mergeWithGroups } from "../service/geometry";
import { WorldContext } from "./world-context";

export function SkinnedMeshDemo() {
  const w = React.useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      gltf: null,
      gltfScene: null,
      clone: null,
      graph: null,
      geometry: null,
      mixer: emptyAnimationMixer,
      groupRef(group) {
        if (group) {
          state.mixer = new THREE.AnimationMixer(group);
          const clips = state.gltf!.animations;
          const idleClip = clips.find((c) => c.name === animationName.idle);
          const walkClip = clips.find((c) => c.name === animationName.walk);
          if (!idleClip || !walkClip) return;

          const idle = state.mixer.clipAction(idleClip);
          idle.play();
          setTimeout(() => {
            idle.fadeOut(0.5);
            state.mixer.clipAction(walkClip).reset().fadeIn(0.5).play();
          }, 0);
        } else {
          state.mixer.stopAllAction();
        }
      },
    }),
  );

  // won't support hot reload onchange gltf
  const queryData =
    useQuery({
      queryKey: [...w.worldQueryPrefix, "template-gltf"],
      queryFn: async () => {
        const [gltf, texture] = await Promise.all([
          new GLTFLoader().loadAsync(url.templateTest0Gltf),
          new THREE.TextureLoader().loadAsync(`${url.templateTexture}${getDevCacheBustQueryParam()}`),
        ]);
        texture.flipY = false;
        texture.minFilter = THREE.NearestFilter;
        texture.magFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        return { gltf, texture };
      },
      staleTime: Infinity, // avoid refetch on HMR
    }).data ?? null;
  state.gltf = queryData?.gltf ?? null;

  // bootstrap after gltf loaded
  if (state.gltf && !state.gltfScene) {
    state.gltfScene = state.gltf.scene;
    state.clone = SkeletonUtils.clone(state.gltf.scene);
    state.graph = buildGraph(state.clone);
    const clonedRoot = state.graph.nodes.root as THREE.SkinnedMesh;
    const shadowQuad = createSkinnedXzQuad(0.8, 0.8);
    state.geometry = mergeWithGroups(clonedRoot.geometry, shadowQuad);
  }

  useFrame((_state, delta) => state.mixer.update(delta));

  const texture = queryData?.texture ?? null;

  const material = useMemo(() => {
    if (!texture) return null;
    const mat = new THREE.MeshStandardNodeMaterial({ alphaTest: 0.9, transparent: true });
    const texNode = tslTexture(texture);
    const viewDir = cameraPosition.sub(positionWorld).normalize();
    const ndotv = normalWorld.dot(viewDir).clamp(0, 1).mul(0.6);
    mat.colorNode = vec4(texNode.rgb.mul(ndotv), texNode.a).add(0);
    return mat;
  }, [texture]);
  const shadowMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "black", opacity: 0.25, transparent: true }),
    [],
  );

  // 🚧 move to bootstrap
  const nodes = state.graph?.nodes;
  const root = nodes?.root as THREE.SkinnedMesh | undefined;
  const bones = nodes ? Object.values(nodes).filter((n) => n instanceof THREE.Bone) : [];

  return state.gltf && material ? (
    <group ref={state.groupRef}>
      <skinnedMesh
        geometry={state.geometry!}
        material={[material, shadowMaterial]}
        skeleton={root!.skeleton}
        scale={0.6} // 🚧
        position={[5, 0.1, 7.5]}
        // renderOrder={3}
      >
        {bones.length > 0 && <primitive object={bones[0]} />}
      </skinnedMesh>
    </group>
  ) : null;
}

const animationName = {
  idle: "idle",
  run: "run",
  walk: "walk",
} as const;

type State = {
  gltf: GLTF | null;
  gltfScene: THREE.Object3D | null;
  clone: THREE.Object3D | null;
  graph: ReturnType<typeof buildGraph> | null;
  geometry: THREE.BufferGeometry | null;
  mixer: THREE.AnimationMixer;
  groupRef(group: null | THREE.Group): void;
};

const emptyAnimationMixer = new THREE.AnimationMixer({} as THREE.Object3D);
