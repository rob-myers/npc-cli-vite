import { url } from "@npc-cli/media";
import { useStateRef } from "@npc-cli/util";
import { Box, useAnimations, useGLTF, useTexture } from "@react-three/drei";
import { buildGraph } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import {
  cameraPosition,
  instanceIndex,
  int,
  normalWorld,
  positionWorld,
  texture,
  texture as tslTexture,
  uv,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { createCheckerBoxMaterial } from "../service/shader";
import type { TexArray } from "../service/tex-array";

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

function drawDemoOutlineFloorTextures(texFloor: TexArray) {
  const size = 256;
  const { ct } = texFloor;

  const layers: ((ct: CanvasRenderingContext2D) => void)[] = [
    // black background with white border
    (ct) => {
      ct.fillStyle = "#000000";
      ct.fillRect(0, 0, size, size);
      ct.strokeStyle = "#ffffff";
      ct.lineWidth = 8;
      ct.strokeRect(4, 4, size - 8, size - 8);
    },
  ];

  texFloor.resize({ numTextures: layers.length, width: size, height: size });
  layers.forEach((draw, i) => {
    ct.clearRect(0, 0, size, size);
    draw(ct);
    texFloor.updateIndex(i);
  });
}

function drawDemoFloorTextures(texFloor: TexArray) {
  const size = 256;
  const cell = size / 4;
  const { ct } = texFloor;

  const layers: ((ct: CanvasRenderingContext2D) => void)[] = [
    // colored grid
    (ct) => {
      const colors = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12"];
      for (let row = 0; row < 4; row++)
        for (let col = 0; col < 4; col++) {
          ct.fillStyle = colors[(row + col) % colors.length];
          ct.fillRect(col * cell, row * cell, cell, cell);
        }
    },
    // diagonal stripes
    (ct) => {
      ct.fillStyle = "#1abc9c";
      ct.fillRect(0, 0, size, size);
      ct.strokeStyle = "#2c3e50";
      ct.lineWidth = 8;
      for (let i = -size; i < size * 2; i += 24) {
        ct.beginPath();
        ct.moveTo(i, 0);
        ct.lineTo(i + size, size);
        ct.stroke();
      }
    },
    // circles / dots
    (ct) => {
      ct.fillStyle = "#9b59b6";
      ct.fillRect(0, 0, size, size);
      ct.fillStyle = "#f1c40f";
      for (let row = 0; row < 4; row++)
        for (let col = 0; col < 4; col++) {
          ct.beginPath();
          ct.arc(col * cell + cell / 2, row * cell + cell / 2, cell / 3, 0, Math.PI * 2);
          ct.fill();
        }
    },
  ];

  texFloor.resize({ numTextures: layers.length, width: size, height: size });
  layers.forEach((draw, i) => {
    ct.clearRect(0, 0, size, size);
    draw(ct);
    texFloor.updateIndex(i);
  });
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

export function createDemoTexArrayMaterial(texArray: TexArray) {
  drawDemoFloorTextures(texArray);
  return createTexArrayBasicMaterial(texArray);
}

export function createTestOutlineTexArrayMaterial(texArray: TexArray) {
  drawDemoOutlineFloorTextures(texArray);
  return createTexArrayBasicMaterial(texArray);
}

const createTexArrayBasicMaterial = (texArray: TexArray) => {
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const texNode = texture(texArray.tex, uv());
  texNode.depthNode = instanceIndex.mod(int(texArray.opts.numTextures));
  mat.colorNode = texNode;
  return mat;
};
