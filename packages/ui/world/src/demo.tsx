import { url } from "@npc-cli/media";
import { useAnimations, useGLTF } from "@react-three/drei";
// import { useGraph } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
// import { SkeletonUtils } from "three-stdlib";

export function TemplateGltfDemo() {
  const groupRef = useRef<THREE.Group>(null);
  const gltf = useGLTF(url.templateGltf);
  const { actions } = useAnimations(gltf.animations, groupRef);
  console.log({ gltf, actions });

  useEffect(() => {
    actions["walk"]?.reset().fadeIn(0.5).play();
    return () => void actions["walk"]?.fadeOut(0.5);
  }, [actions]);

  return (
    <group ref={groupRef}>
      <primitive object={gltf.scene} />
    </group>
  );
}

export function SkinnedMeshTemplateDemo() {
  const groupRef = useRef<THREE.Group>(null);
  const gltf = useGLTF(url.templateGltf);
  // const clone = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf.scene]);
  // const { nodes, materials: _materials } = useGraph(clone);
  const { actions } = useAnimations(gltf.animations, groupRef);

  useEffect(() => {
    actions["walk"]?.reset().fadeIn(0.5).play();
    return () => void actions["walk"]?.fadeOut(0.5);
  }, [actions]);

  // const mesh = gltf.nodes["hips"] as THREE.SkinnedMesh;
  const bones = Object.values(gltf.nodes).filter((n) => n instanceof THREE.Bone);
  console.log({ gltf, actions, bones }, bones[0]);

  const root = gltf.nodes.root as THREE.SkinnedMesh;

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
        <primitive
          object={bones[0]} // 🚧
        />
      </skinnedMesh>
    </group>
  );
}

export function WalkingRobotGuyGltfOnlyDemo() {
  const groupRef = useRef<THREE.Group>(null);
  const gltf = useGLTF(url.walkingRobotGuyGltf);
  const { actions } = useAnimations(gltf.animations, groupRef);
  console.log({ gltf, actions });

  useEffect(() => {
    actions["walk_animation"]?.reset().fadeIn(0.5).play();
    return () => void actions["walk_animation"]?.fadeOut(0.5);
  }, [actions]);

  return (
    <group ref={groupRef}>
      <primitive object={gltf.scene} />
    </group>
  );
}

export function SkinnedMeshWithAnimationDemo() {
  const groupRef = useRef<THREE.Group>(null);

  // Blockbench: Export Groups as Armature
  const gltf = useGLTF(url.testBlockBench5Gltf);
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
