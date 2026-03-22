import { url } from "@npc-cli/media";
import { useStateRef } from "@npc-cli/util";
import { Box, useAnimations, useGLTF, useTexture } from "@react-three/drei";
import { buildGraph } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { cameraPosition, normalWorld, positionWorld, texture as tslTexture, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { createCheckerBoxMaterial } from "../service/shader";

export function SkinnedMeshTemplateDemo() {
  const groupRef = useRef<THREE.Group>(null);
  const gltf = useGLTF(url.templateGltf);

  // clone and buildGraph in useState fixes HMR
  const state = useStateRef(() => {
    const clone = SkeletonUtils.clone(gltf.scene);
    return { clone, graph: buildGraph(clone) };
  });
  const { nodes } = state.graph;
  const { actions } = useAnimations(gltf.animations, groupRef); // cannot clone animations?

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
    mat.colorNode = vec4(texNode.rgb.mul(ndotv), texNode.a).add(0);
    return mat;
  }, [texture]);

  useEffect(() => {
    console.log({ gltf, actions, rootBone: bones[0], material: root.material });

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
        // position={[0, 0, 0]}
        // position={root.position}
        // userData={root.userData}
      >
        {bones[0] && <primitive object={bones[0]} />}
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

export function DemoCheckerBox() {
  const mat = useMemo(() => createCheckerBoxMaterial(), []);
  return <Box args={[1, 1, 1, 10, 1, 10]} position={[0, 0, 0]} scale={[100, 0.001, 100]} material={mat} />;
}

export const demoInstancedQuad = {
  metas: [
    { pos: [-8, 0, -8], color: 0xe74c3c },
    { pos: [0, 0, -8], color: 0x3498db },
    { pos: [8, 0, -8], color: 0x2ecc71 },
    { pos: [-8, 0, 0], color: 0xf39c12 },
    { pos: [0, 0, 0], color: 0x9b59b6 },
    { pos: [8, 0, 0], color: 0x1abc9c },
    { pos: [-8, 0, 8], color: 0xe67e22 },
    { pos: [0, 0, 8], color: 0x2980b9 },
    { pos: [8, 0, 8], color: 0xd35400 },
    { pos: [0, 0, -16], color: 0x27ae60 },
  ] as const,

  ref(inst: THREE.InstancedMesh | null) {
    if (inst == null) return;
    const mat = new THREE.Matrix4();
    const col = new THREE.Color();
    const scl = new THREE.Vector3(6, 1, 6);
    demoInstancedQuad.metas.forEach(({ pos: [x, y, z], color }, i) => {
      mat.makeTranslation(x, y, z).scale(scl);
      inst.setMatrixAt(i, mat);
      inst.setColorAt(i, col.set(color));
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  },
};
