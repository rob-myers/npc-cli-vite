import { url } from "@npc-cli/media";
import { useStateRef } from "@npc-cli/util";
import { useAnimations, useTexture } from "@react-three/drei";
import { buildGraph } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useMemo, useRef } from "react";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cameraPosition, normalWorld, positionWorld, texture as tslTexture, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { WorldContext } from "./world-context";

export function SkinnedMeshTemplateDemo() {
  const w = React.useContext(WorldContext);
  const groupRef = useRef<THREE.Group>(null);

  const gltf = useQuery({
    queryKey: [...w.worldQueryPrefix, "template-gltf"],
    queryFn: () => new GLTFLoader().loadAsync(url.templateTest0Gltf),
  }).data;

  // clone and buildGraph in useStateRef fixes HMR
  const state = useStateRef((): State => ({ gltfScene: null, clone: null, graph: null }));
  if (gltf && state.gltfScene !== gltf.scene) {
    state.gltfScene = gltf.scene;
    state.clone = SkeletonUtils.clone(gltf.scene);
    state.graph = buildGraph(state.clone);
  }

  const nodes = state.graph?.nodes;
  const { actions } = useAnimations(gltf?.animations ?? [], groupRef);

  const root = nodes?.root as THREE.SkinnedMesh | undefined;
  const bones = nodes ? Object.values(nodes).filter((n) => n instanceof THREE.Bone) : [];

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

  useEffect(() => {
    actions[animationName.idle]?.play();
    setTimeout(() => {
      actions[animationName.idle]?.fadeOut(0.5);
      actions[animationName.walk]?.reset().fadeIn(0.5).play();
    }, 0);

    return () => {
      Object.values(actions).forEach((a) => a?.stop());
    };
  }, [actions]);

  if (!root) return <group ref={groupRef} />;

  return (
    <group ref={groupRef}>
      <skinnedMesh
        name="root"
        geometry={root.geometry}
        material={material}
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
};
