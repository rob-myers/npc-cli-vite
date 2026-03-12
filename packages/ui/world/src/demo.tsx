import { url } from "@npc-cli/media";
import { useAnimations, useGLTF } from "@react-three/drei";
import { useGraph } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";

export function SkinnedMeshTemplateDemo() {
  const groupRef = useRef<THREE.Group>(null);
  const gltf = useGLTF(url.templateGltf);
  const clone = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf.scene]);
  const { nodes, materials: _materials } = useGraph(clone);
  const { actions } = useAnimations(gltf.animations, groupRef);

  const animationName = "walk";

  useEffect(() => {
    actions[animationName]?.reset().fadeIn(0.5).play();
    console.log({ gltf, actions, rootBone: bones[0] });
    return () => void actions[animationName]?.fadeOut(0.5);
  }, [actions]);

  const root = nodes.root as THREE.SkinnedMesh;
  const bones = Object.values(nodes).filter((n) => n instanceof THREE.Bone);

  return (
    <group ref={groupRef}>
      <skinnedMesh
        name="root"
        geometry={root.geometry}
        material={root.material}
        skeleton={root.skeleton}
        // position={root.position}
        // userData={root.userData}
      >
        {bones[0] && <primitive object={bones[0]} />}
      </skinnedMesh>
    </group>
  );
}
