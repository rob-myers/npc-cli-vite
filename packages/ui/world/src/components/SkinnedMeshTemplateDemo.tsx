import { url } from "@npc-cli/media";
import { useStateRef } from "@npc-cli/util";
import { useTexture } from "@react-three/drei";
import { buildGraph, useFrame } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useMemo, useRef } from "react";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cameraPosition, normalWorld, positionWorld, texture as tslTexture, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { createSkinnedXzQuad, mergeWithGroups } from "../service/geometry";
import { WorldContext } from "./world-context";

export function SkinnedMeshTemplateDemo() {
  const w = React.useContext(WorldContext);
  const groupRef = useRef<THREE.Group>(null);

  const gltf = useQuery({
    queryKey: [...w.worldQueryPrefix, "template-gltf"],
    queryFn: () => new GLTFLoader().loadAsync(url.templateTest0Gltf),
  }).data;

  const state = useStateRef(
    (): State => ({ gltfScene: null, clone: null, graph: null, geometry: null, mixer: new THREE.AnimationMixer({} as THREE.Object3D) }),
  );
  if (gltf && state.gltfScene !== gltf.scene) {
    state.gltfScene = gltf.scene;
    state.clone = SkeletonUtils.clone(gltf.scene);
    state.graph = buildGraph(state.clone);
    const clonedRoot = state.graph.nodes.root as THREE.SkinnedMesh;
    const shadowQuad = createSkinnedXzQuad(0.8, 0.8);
    state.geometry = mergeWithGroups(clonedRoot.geometry, shadowQuad);
  }

  const nodes = state.graph?.nodes;
  const root = nodes?.root as THREE.SkinnedMesh | undefined;
  const bones = nodes ? Object.values(nodes).filter((n) => n instanceof THREE.Bone) : [];

  useFrame((_state, delta) => state.mixer.update(delta));

  useEffect(() => {
    if (!gltf || !groupRef.current) return;
    // rebind mixer to current group so it can find bones by name
    (state.mixer as unknown as { _root: THREE.Object3D })._root = groupRef.current;

    const clips = gltf.animations;
    const idleClip = clips.find((c) => c.name === animationName.idle);
    const walkClip = clips.find((c) => c.name === animationName.walk);
    if (!idleClip || !walkClip) return;

    const idle = state.mixer.clipAction(idleClip);
    idle.play();
    setTimeout(() => {
      idle.fadeOut(0.5);
      state.mixer.clipAction(walkClip).reset().fadeIn(0.5).play();
    }, 0);

    const group = groupRef.current;
    return () => {
      state.mixer.stopAllAction();
      if (group) state.mixer.uncacheRoot(group);
    };
  }, [gltf]);

  const texture = useTexture(url.templateTexture, (texture) => {
    texture.flipY = false;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
  });
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardNodeMaterial({ alphaTest: 0.9 });
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

  if (!root || !state.geometry) return <group ref={groupRef} />;

  return (
    <group ref={groupRef}>
      <skinnedMesh
        name="root"
        geometry={state.geometry}
        material={[material, shadowMaterial]}
        skeleton={root.skeleton}
        scale={0.65} // 🚧
        position={[5, 0.1, 7.5]}
      >
        {bones.length > 0 && <primitive object={bones[0]} />}
      </skinnedMesh>
    </group>
  );
}

const animationName = {
  idle: "idle",
  run: "run",
  walk: "walk",
} as const;

type State = {
  gltfScene: THREE.Object3D | null;
  clone: THREE.Object3D | null;
  graph: ReturnType<typeof buildGraph> | null;
  geometry: THREE.BufferGeometry | null;
  mixer: THREE.AnimationMixer;
};
