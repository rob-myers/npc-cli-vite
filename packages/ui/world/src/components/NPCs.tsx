import { url } from "@npc-cli/media";
import { useStateRef } from "@npc-cli/util";
import { getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { buildGraph } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import { Suspense, useContext } from "react";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cameraPosition, normalWorld, positionWorld, texture as tslTexture, uniform, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { createSkinnedXzQuad, mergeWithGroups } from "../service/geometry";
import { PICK_TYPE, withPickOutputId } from "../service/pick";
import { MemoNpcInstance } from "./NpcInstance";
import { WorldContext } from "./world-context";

const npcKeyPattern = /^[a-z][a-z0-9-]*$/;

export default function NPCs() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      byPickId: {} as Record<number, Npc>,
      gltf: null,
      nextPickId: 0,
      shadowMaterial: new THREE.MeshBasicMaterial({ color: "black", opacity: 0.25, transparent: true }),
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
        const shadowQuad = createSkinnedXzQuad(0.8, 0.8);
        const geometry = mergeWithGroups(clonedRoot.geometry, shadowQuad);

        const npc: Npc = {
          key: npcKey,
          pickId: state.nextPickId,
          position,
          group: null,
          material: state.createNpcMaterial(),
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
        npc.geometry.dispose();
        delete state.byPickId[npc.pickId];
        delete state.npc[npcKey];
        state.epoch++;
        state.update();
      },
      onTick(delta) {
        for (const npc of Object.values(state.npc)) {
          npc.mixer.update(delta);
        }
      },
    }),
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
  position: [number, number, number];
  group: THREE.Group | null;
  material: THREE.MeshStandardNodeMaterial;
  mixer: THREE.AnimationMixer;
  clone: THREE.Object3D;
  graph: ReturnType<typeof buildGraph>;
  geometry: THREE.BufferGeometry;
};

export type State = {
  byPickId: Record<number, Npc>;
  gltf: GLTF | null;
  nextPickId: number;
  shadowMaterial: THREE.MeshBasicMaterial;
  texture: THREE.Texture | null;
  npc: Record<string, Npc>;
  epoch: number;

  createNpcMaterial(): THREE.MeshStandardNodeMaterial;
  spawn(args: { npcKey: string; position: [number, number, number] }): void;
  remove(npcKey: string): void;
  onTick(delta: number): void;
};

const emptyAnimationMixer = new THREE.AnimationMixer({} as THREE.Object3D);
