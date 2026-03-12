import { url } from "@npc-cli/media";
import { useAnimations, useGLTF, useTexture } from "@react-three/drei";
import { useGraph } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { cameraPosition, normalWorld, positionWorld, texture as tslTexture, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { SkeletonUtils } from "three-stdlib";

export function SkinnedMeshTemplateDemo() {
  const groupRef = useRef<THREE.Group>(null);
  const gltf = useGLTF(url.templateGltf);
  const clone = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf.scene]);
  const { nodes, materials: _materials } = useGraph(clone);
  const { actions } = useAnimations(gltf.animations, groupRef);

  const root = nodes.root as THREE.SkinnedMesh;
  const bones = Object.values(nodes).filter((n) => n instanceof THREE.Bone);

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
    const ndotv = normalWorld.dot(viewDir).clamp(0, 1);
    mat.colorNode = vec4(texNode.rgb.mul(ndotv), texNode.a);
    return mat;
  }, [texture]);

  useEffect(() => {
    console.log({ gltf, actions, rootBone: bones[0], material: root.material });
    const animationName = "walk";
    actions[animationName]?.reset().fadeIn(0.5).play();
    return () => {
      actions[animationName]?.fadeOut(0.5);
    };
  }, [actions]);

  return (
    <group ref={groupRef}>
      <skinnedMesh
        name="root"
        geometry={root.geometry}
        // material={root.material}
        material={material}
        skeleton={root.skeleton}
        position={root.position}
        // userData={root.userData}
      >
        {bones[0] && <primitive object={bones[0]} />}
      </skinnedMesh>
    </group>
  );
}
