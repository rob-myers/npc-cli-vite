import { url } from "@npc-cli/media";
import { useStateRef } from "@npc-cli/util";
import { getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { buildGraph } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import { Suspense, useContext, useEffect } from "react";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  float,
  modelWorldMatrix,
  normalWorld,
  positionLocal,
  positionWorld,
  texture as tslTexture,
  uniform,
  uv,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { MAX_NPCS, npcScale } from "../const";
import {
  addEmptyBillboardOffset,
  createSkinnedLabelQuad,
  createSkinnedXzQuad,
  mergeWithGroups,
} from "../service/geometry";
import { PICK_TYPE, withPickOutputId } from "../service/pick";
import { TexArray } from "../service/tex-array";
import { MemoNpcInstance } from "./NpcInstance";
import { WorldContext } from "./world-context";

const npcKeyPattern = /^[a-z][a-z0-9-]*$/;

export default function NPCs() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      byPickId: {} as Record<number, Npc>,
      gltf: null,
      labelTexArray: new TexArray({ ctKey: "npc-labels", width: 256, height: 64, numTextures: MAX_NPCS }),
      nextPickId: 0,
      shadowMaterial: createShadowMaterial(),
      texture: null,
      npc: {},
      epoch: 0,

      createNpcMaterial() {
        if (!state.texture) throw Error("texture not loaded yet");
        const pickId = uniform(state.nextPickId++);
        const mat = new THREE.MeshStandardNodeMaterial({ alphaTest: 0.9, transparent: true });
        const texNode = tslTexture(state.texture);
        const viewDir = cameraPosition.sub(positionWorld).normalize();
        const ndotv = normalWorld.dot(viewDir).clamp(0, 1).mul(0.8);
        mat.colorNode = vec4(texNode.rgb.mul(ndotv), texNode.a).add(0);
        mat.outputNode = withPickOutputId(PICK_TYPE.npcs, pickId);
        return mat;
      },
      spawn({ npcKey, position }) {
        if (typeof npcKey !== "string") throw Error("opts.npcKey: must be a string");
        if (!Array.isArray(position) || !position.every((x) => typeof x === "number"))
          throw Error("opts.position: must be a numeric array");
        if (!npcKeyPattern.test(npcKey)) {
          throw Error(`npcKey must match ${npcKeyPattern}: got "${npcKey}"`);
        }
        if (npcKey in state.npc) {
          throw Error(`npcKey "${npcKey}" already exists`);
        }
        if (!state.gltf) {
          throw Error("GLTF not loaded yet");
        }

        const clone = SkeletonUtils.clone(state.gltf.scene);
        const graph = buildGraph(clone);
        const clonedRoot = graph.nodes.root as THREE.SkinnedMesh;
        const headBoneIndex = clonedRoot.skeleton.bones.findIndex((b) => b.name === "head");

        const shadowQuad = createSkinnedXzQuad(1, 1);
        // 0.5 / 0.125 = 4:1, matching 256 x 64
        const labelQuad = createSkinnedLabelQuad(0.5, 0.125, 1.25 / npcScale, headBoneIndex >= 0 ? headBoneIndex : 0);
        addEmptyBillboardOffset(clonedRoot.geometry);
        addEmptyBillboardOffset(shadowQuad);
        const geometry = mergeWithGroups(clonedRoot.geometry, shadowQuad, labelQuad);

        const labelLayerIndex = state.nextPickId;
        drawLabelLayer(state.labelTexArray, labelLayerIndex, npcKey);

        const npc: Npc = {
          key: npcKey,
          pickId: state.nextPickId,
          labelLayerIndex,
          position,
          group: null,
          material: state.createNpcMaterial(),
          labelMaterial: createLabelMaterial(state.labelTexArray, labelLayerIndex),
          mixer: emptyAnimationMixer,
          clone,
          graph,
          geometry,
        };

        state.npc[npcKey] = npc;
        state.byPickId[npc.pickId] = npc;
        state.epoch++;
        state.update();
      },
      remove(npcKey) {
        const npc = state.npc[npcKey];
        if (!npc) return;
        npc.mixer.stopAllAction();
        npc.material.dispose();
        npc.labelMaterial.dispose();
        npc.geometry.dispose();
        delete state.byPickId[npc.pickId];
        delete state.npc[npcKey];
        state.epoch++;
        state.update();
      },
      refreshMaterials() {
        if (!state.texture) return;
        for (const npc of Object.values(state.npc)) {
          npc.material.dispose();
          npc.material = state.createNpcMaterial();
        }
        state.epoch++;
        state.update();
      },
      onTick(delta) {
        for (const npc of Object.values(state.npc)) {
          npc.mixer.update(delta);
        }
      },
    }),
    {
      reset: { shadowMaterial: true },
    },
  );

  w.npc = state;

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
      staleTime: Infinity,
    }).data ?? null;

  state.gltf = queryData?.gltf ?? null;
  state.texture = queryData?.texture ?? null;

  useEffect(() => {
    if (import.meta.env.DEV) {
      state.refreshMaterials();
    }
  }, []);

  const { gltf } = state;

  return (
    <group>
      <Suspense>
        {gltf &&
          Object.values(state.npc).map((npc) => (
            <MemoNpcInstance
              key={npc.key}
              npc={npc}
              shadowMaterial={state.shadowMaterial}
              gltf={gltf}
              epoch={state.epoch}
            />
          ))}
      </Suspense>
    </group>
  );
}

export type Npc = {
  key: string;
  pickId: number;
  labelLayerIndex: number;
  position: [number, number, number];
  group: THREE.Group | null;
  material: THREE.MeshStandardNodeMaterial;
  labelMaterial: THREE.MeshBasicNodeMaterial;
  mixer: THREE.AnimationMixer;
  clone: THREE.Object3D;
  graph: ReturnType<typeof buildGraph>;
  geometry: THREE.BufferGeometry;
};

export type State = {
  byPickId: Record<number, Npc>;
  gltf: GLTF | null;
  labelTexArray: TexArray;
  nextPickId: number;
  shadowMaterial: THREE.MeshBasicNodeMaterial;
  texture: THREE.Texture | null;
  npc: Record<string, Npc>;
  epoch: number;

  createNpcMaterial(): THREE.MeshStandardNodeMaterial;
  refreshMaterials(): void;
  spawn(args: { npcKey: string; position: [number, number, number] }): void;
  remove(npcKey: string): void;
  onTick(delta: number): void;
};

const emptyAnimationMixer = new THREE.AnimationMixer({} as THREE.Object3D);

function drawLabelLayer(texArray: TexArray, layerIndex: number, npcKey: string) {
  const { ct } = texArray;
  const { width, height } = ct.canvas;
  ct.clearRect(0, 0, width, height);
  ct.fillStyle = "rgba(0, 0, 0, 0.5)";
  ct.roundRect(0, 0, width, height, 8);
  ct.fill();
  ct.fillStyle = "white";
  ct.font = "36px sans-serif";
  ct.textAlign = "center";
  ct.textBaseline = "middle";
  ct.fillText(npcKey, width / 2, height / 2);
  texArray.updateIndex(layerIndex);
}

function createLabelMaterial(texArray: TexArray, layerIndex: number) {
  const texNode = tslTexture(texArray.tex);
  const layerNode = texNode.depth(uniform(layerIndex));
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  mat.colorNode = layerNode;
  mat.opacityNode = layerNode.a;

  const offset = attribute("billboardOffset", "vec2");
  const worldCenter = modelWorldMatrix.mul(vec4(positionLocal, 1));
  const viewCenter = cameraViewMatrix.mul(worldCenter);
  const viewPos = viewCenter.add(vec4(offset, 0, 0));
  mat.vertexNode = cameraProjectionMatrix.mul(viewPos);

  return mat;
}

function createShadowMaterial() {
  const center = uv().sub(0.5);
  const dist = center.dot(center).mul(4);
  const alpha = float(1).sub(dist).clamp(0, 1);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, opacity: 1 });
  mat.colorNode = vec4(0, 0, 0, 1);
  mat.opacityNode = alpha.mul(0.6);
  return mat;
}
