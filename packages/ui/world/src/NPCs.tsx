import { url } from "@npc-cli/media";
import { useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function NPCs() {
  const groupRef = useRef<THREE.Group>(null);

  // Blockbench: Export Groups as Armature
  const gltf = useGLTF(url.testBlockBench5Gltf);
  // const gltf = useGLTF(url.humanZeroGltf);
  const { actions } = useAnimations(gltf.animations, groupRef);

  useEffect(() => {
    actions["dummy-animation"]?.reset().fadeIn(0.5).play();
    return () => void actions["dummy-animation"]?.fadeOut(0.5);
  }, [actions]);

  const mesh = gltf.nodes["hips"] as THREE.SkinnedMesh;
  const bones = Object.values(gltf.nodes).filter((n) => n instanceof THREE.Bone);
  console.log({ gltf, actions, bones });

  return (
    <group ref={groupRef}>
      {/* <primitive object={gltf.scene} /> */}

      <skinnedMesh
        geometry={mesh.geometry}
        // position={mesh.position}
        skeleton={mesh.skeleton}
        userData={mesh.userData}
        material={mesh.material}
      >
        <primitive
          object={bones[0]} // hips_1
        />
      </skinnedMesh>
    </group>
  );
}
