import { url } from "@npc-cli/media";
import { useStateRef } from "@npc-cli/util";
import { getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { buildGraph } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import { useContext, useEffect } from "react";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cameraPosition, normalWorld, positionWorld, texture as tslTexture, uniform, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { MAX_NPCS, npcScale } from "../const";
import {
  addEmptyBillboardOffset,
  createSkinnedLabelQuad,
  createSkinnedXzQuad,
  groundPointToVector3,
  mergeWithGroups,
  parseGroundPoint,
} from "../service/geometry";
import { PICK_TYPE, withPickOutputId } from "../service/pick";
import { TexArray } from "../service/tex-array";
import { createLabelMaterial, createShadowMaterial, drawLabelLayer } from "../service/texture";
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

      createNpcMaterial(pickId) {
        if (!state.texture) throw Error("texture not loaded yet");
        const pickIdNode = uniform(pickId);
        const mat = new THREE.MeshStandardNodeMaterial({ alphaTest: 0.9, transparent: true });
        const texNode = tslTexture(state.texture);
        const viewDir = cameraPosition.sub(positionWorld).normalize();
        const ndotv = normalWorld.dot(viewDir).clamp(0, 1).mul(0.8);
        mat.colorNode = vec4(texNode.rgb.mul(ndotv), texNode.a).add(0);
        mat.outputNode = withPickOutputId(PICK_TYPE.npc, pickIdNode);
        return mat;
      },
      devRefreshMaterials() {
        if (!state.texture) return;
        for (const npc of Object.values(state.npc)) {
          npc.material.dispose();
          npc.material = state.createNpcMaterial(npc.pickId);
          npc.labelMaterial.dispose();
          npc.labelMaterial = createLabelMaterial(state.labelTexArray, npc.labelLayerIndex);
          const labelLayerIndex = npc.pickId;
          drawLabelLayer(state.labelTexArray, labelLayerIndex, npc.key);
          npc.epoch++;
        }
        state.update();
      },
      spawn({ npcKey, at }) {
        if (!state.gltf) {
          throw Error("GLTF not loaded yet");
        }
        if (typeof npcKey !== "string" || !npcKeyPattern.test(npcKey)) {
          throw Error(`npcKey "${npcKey}" must match: ${npcKeyPattern}`);
        }
        if (!at) throw Error("opts.at: must exist");
        const groundPoint = parseGroundPoint(at);

        if (npcKey in state.npc) {
          // respawn
          const npc = state.npc[npcKey] as Npc;
          npc.position.copy(groundPointToVector3(groundPoint));
          w.view.forceRender();
          return;
        }

        const clone = SkeletonUtils.clone(state.gltf.scene);
        const graph = buildGraph(clone);
        const clonedSkinnedMesh = graph.nodes.root as THREE.SkinnedMesh;
        const headBoneIndex = clonedSkinnedMesh.skeleton.bones.findIndex((b) => b.name === "head");

        const shadowQuad = createSkinnedXzQuad(1, 1);
        // 0.5 / 0.125 = 4:1, matching 256 x 64
        const labelQuad = createSkinnedLabelQuad(0.5, 0.125, 1.25 / npcScale, headBoneIndex >= 0 ? headBoneIndex : 0);
        addEmptyBillboardOffset(clonedSkinnedMesh.geometry);
        addEmptyBillboardOffset(shadowQuad);
        const geometry = mergeWithGroups(clonedSkinnedMesh.geometry, shadowQuad, labelQuad);

        const pickId = state.nextPickId;
        const labelLayerIndex = pickId;
        drawLabelLayer(state.labelTexArray, labelLayerIndex, npcKey);

        const npc: Npc = {
          key: npcKey,
          pickId,
          labelLayerIndex,
          position: groundPointToVector3(groundPoint),
          group: null,
          material: state.createNpcMaterial(pickId),
          labelMaterial: createLabelMaterial(state.labelTexArray, labelLayerIndex),
          mixer: emptyAnimationMixer,
          skinnedMesh: clonedSkinnedMesh,
          graph,
          geometry,
          epoch: 0,
        };

        state.npc[npcKey] = npc;
        state.byPickId[npc.pickId] = npc;
        state.nextPickId++;
        state.update();
      },
      remove(...npcKeys) {
        for (const npcKey of npcKeys) {
          const npc = state.npc[npcKey];
          if (!npc) continue;
          npc.mixer.stopAllAction();
          npc.material.dispose();
          npc.labelMaterial.dispose();
          npc.geometry.dispose();
          delete state.byPickId[npc.pickId];
          delete state.npc[npcKey];
        }
        if (Object.keys(state.npc).length === 0) {
          state.nextPickId = 0;
        }
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
      state.devRefreshMaterials();
    }
  }, []);

  const { gltf } = state;

  return (
    gltf &&
    Object.values(state.npc).map((npc) => (
      <MemoNpcInstance key={npc.key} npc={npc} shadowMaterial={state.shadowMaterial} gltf={gltf} epoch={npc.epoch} />
    ))
  );
}

export type Npc = {
  key: string;
  pickId: number;
  labelLayerIndex: number;
  position: THREE.Vector3;
  /** On mount */
  group: THREE.Group | null;
  material: THREE.MeshStandardNodeMaterial;
  labelMaterial: THREE.MeshBasicNodeMaterial;
  mixer: THREE.AnimationMixer;
  skinnedMesh: THREE.SkinnedMesh;
  graph: ReturnType<typeof buildGraph>;
  geometry: THREE.BufferGeometry;
  epoch: number;
};

export type State = {
  byPickId: Record<number, Npc>;
  gltf: GLTF | null;
  labelTexArray: TexArray;
  nextPickId: number;
  shadowMaterial: THREE.MeshBasicNodeMaterial;
  texture: THREE.Texture | null;
  npc: Record<string, Npc>;

  createNpcMaterial(pickId: number): THREE.MeshStandardNodeMaterial;
  devRefreshMaterials(): void;
  spawn(opts: JshCli.SpawnOpts): void;
  remove(...npcKeys: string[]): void;
  onTick(delta: number): void;
};

const emptyAnimationMixer = new THREE.AnimationMixer({} as THREE.Object3D);
