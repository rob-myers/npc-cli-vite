import { url } from "@npc-cli/media";
import { useStateRef } from "@npc-cli/util";
import { useAnimations, useGLTF, useTexture } from "@react-three/drei";
import { buildGraph } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { cameraPosition, normalWorld, positionWorld, texture as tslTexture, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";

export function SkinnedMeshTemplateDemo() {
  const groupRef = useRef<THREE.Group>(null);
  // const gltf = useGLTF(url.templateGltf);
  const gltf = useGLTF(url.templateTest0Gltf);

  // clone and buildGraph in useState fixes HMR
  const state = useStateRef(() => {
    const clone = SkeletonUtils.clone(gltf.scene);
    return { clone, graph: buildGraph(clone) };
  });
  const { nodes } = state.graph;
  const { actions } = useAnimations(gltf.animations, groupRef); // cannot clone animations?

  const root = nodes.root as THREE.SkinnedMesh;
  const otherRoot = nodes.other as THREE.SkinnedMesh;
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
    const ndotv = normalWorld.dot(viewDir).clamp(0, 1).mul(0.6);
    mat.colorNode = vec4(texNode.rgb.mul(ndotv), texNode.a).add(0);
    return mat;
  }, [texture]);

  useEffect(() => {
    // console.log({ gltf, actions, rootBone: bones[0], material: root.material });

    actions[animationName.idle]?.play();
    setTimeout(() => {
      actions[animationName.idle]?.fadeOut(0.5);
      actions[animationName.walk]?.reset().fadeIn(0.5).play();
    }, 0);

    return () => {
      Object.values(actions).forEach((a) => a?.stop());
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
        scale={0.65} // 🚧
        position={[5, 0.1, 7.5]}
        // position={root.position}
        // userData={root.userData}
      >
        {bones && <primitive object={bones[0]} />}

        {/* 🚧 rename as shadowRoot in model */}
        <mesh geometry={otherRoot.geometry}>
          <meshBasicMaterial color="black" opacity={0.25} transparent />
        </mesh>
      </skinnedMesh>
    </group>
  );
}

const animationName = {
  idle: "idle",
  run: "run",
  walk: "walk",
} as const;

useGLTF.preload(url.templateGltf);
