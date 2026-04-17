import { url } from "@npc-cli/media";
import { useStateRef } from "@npc-cli/util";
import { getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { buildGraph } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import { Suspense, useContext, useMemo } from "react";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cameraPosition, normalWorld, positionWorld, texture as tslTexture, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { createSkinnedXzQuad, mergeWithGroups } from "../service/geometry";
import { MemoNpcInstance } from "./NpcInstance";
import { WorldContext } from "./world-context";

const npcKeyPattern = /^[a-z][a-z0-9-]*$/;

export default function NPCs() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      gltf: null,
      texture: null,
      material: null,
      shadowMaterial: new THREE.MeshBasicMaterial({ color: "black", opacity: 0.25, transparent: true }),
      npc: {},
      epoch: 0,

      spawn({ npcKey, position }) {
        if (typeof npcKey !== "string") throw Error("opts.npcKey: must be a string");
        // 🚧 generic point type {x,y}, {x,y,z}, [x,y], [x,y,z]
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
          position,
          group: null,
          mixer: emptyAnimationMixer,
          clone,
          graph,
          geometry,
        };

        state.npc[npcKey] = npc;
        state.epoch++;
        state.update();
      },
      remove(npcKey) {
        const npc = state.npc[npcKey];
        if (!npc) return;
        npc.mixer.stopAllAction();
        npc.geometry.dispose();
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

  const material = useMemo(() => {
    if (!state.texture) return null;
    const mat = new THREE.MeshStandardNodeMaterial({ alphaTest: 0.9, transparent: true });
    const texNode = tslTexture(state.texture);
    const viewDir = cameraPosition.sub(positionWorld).normalize();
    const ndotv = normalWorld.dot(viewDir).clamp(0, 1).mul(0.8);
    mat.colorNode = vec4(texNode.rgb.mul(ndotv), texNode.a).add(0);
    return mat;
  }, [state.texture]);
  state.material = material;

  const { gltf } = state;

  return (
    <group>
      <Suspense>
        {material &&
          gltf &&
          Object.values(state.npc).map((npc) => (
            <MemoNpcInstance
              key={npc.key}
              npc={npc}
              material={material}
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
  position: [number, number, number];
  group: THREE.Group | null;
  mixer: THREE.AnimationMixer;
  clone: THREE.Object3D;
  graph: ReturnType<typeof buildGraph>;
  geometry: THREE.BufferGeometry;
};

export type State = {
  gltf: GLTF | null;
  texture: THREE.Texture | null;
  material: THREE.MeshStandardNodeMaterial | null;
  shadowMaterial: THREE.MeshBasicMaterial;
  npc: Record<string, Npc>;
  epoch: number;

  spawn(args: { npcKey: string; position: [number, number, number] }): void;
  remove(npcKey: string): void;
  onTick(delta: number): void;
};

const emptyAnimationMixer = new THREE.AnimationMixer({} as THREE.Object3D);
