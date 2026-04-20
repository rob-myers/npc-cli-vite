import { url } from "@npc-cli/media";
import { useStateRef } from "@npc-cli/util";
import { getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { buildGraph } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import { ANY_QUERY_FILTER, createFindNearestPolyResult, findNearestPoly } from "navcat";
import { crowd as crowdApi } from "navcat/blocks";
import { useContext, useEffect } from "react";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
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
import { Npc } from "./npc";
import { WorldContext } from "./world-context";

const npcKeyPattern = /^[a-z][a-z0-9-]*$/;

export default function NPCs() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      byPickId: {} as Record<number, Npc>,
      clips: { idle: null, walk: null, run: null },
      crowd: crowdApi.create(0.3),
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
      devHotReload() {
        if (!state.texture) return;
        for (const [key, old] of Object.entries(state.npc)) {
          old.material.dispose();
          old.labelMaterial.dispose();
          const npc = new Npc(w, {
            key: old.key,
            pickId: old.pickId,
            labelLayerIndex: old.labelLayerIndex,
            position: old.position,
            material: state.createNpcMaterial(old.pickId),
            labelMaterial: createLabelMaterial(state.labelTexArray, old.labelLayerIndex),
            skinnedMesh: old.skinnedMesh,
            graph: old.graph,
            geometry: old.geometry,
          });
          npc.agentId = old.agentId;
          drawLabelLayer(state.labelTexArray, npc.labelLayerIndex, npc.key);
          state.npc[key] = npc;
          state.byPickId[npc.pickId] = npc;
        }
        state.update();
      },
      move({ npcKey, to }) {
        const npc = state.npc[npcKey];

        if (!w.nav) {
          throw Error("w.nav must exist");
        }
        if (typeof npcKey !== "string" || !npc) {
          throw Error(`npcKey "${npcKey}" must exist`);
        }
        if (!npc.agentId) {
          throw Error("npcKey has no agent");
        }

        const target = parseGroundPoint(to);
        const targetPos: [number, number, number] = [target.x, 0, target.y];
        const result = findNearestPoly(
          createFindNearestPolyResult(),
          w.nav.navMesh,
          targetPos,
          [0.1, 0.1, 0.1],
          ANY_QUERY_FILTER,
        );
        if (result.success) {
          crowdApi.requestMoveTarget(state.crowd, npc.agentId, result.nodeRef, result.position);
        } else {
          throw Error("move failed");
        }
      },
      onTick(delta) {
        if (w.nav) {
          crowdApi.update(state.crowd, w.nav.navMesh, delta);
          for (const npc of Object.values(state.npc)) {
            if (npc.agentId) {
              const agent = state.crowd.agents[npc.agentId];
              if (agent) {
                npc.position.set(agent.position[0], agent.position[1], agent.position[2]);
              }
            }
            npc.mixer.update(delta);
          }
        } else {
          for (const npc of Object.values(state.npc)) {
            npc.mixer.update(delta);
          }
        }
      },
      remove(...npcKeys) {
        for (const npcKey of npcKeys) {
          const npc = state.npc[npcKey];
          if (!npc) continue;
          npc.mixer.stopAllAction();
          if (npc.agentId) crowdApi.removeAgent(state.crowd, npc.agentId);
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
      respawn(npc, groundPoint) {
        const targetTuple = [groundPoint.x, 0, groundPoint.y] as [number, number, number];
        const result =
          w.nav && npc.agentId !== null
            ? findNearestPoly(
                createFindNearestPolyResult(),
                w.nav.navMesh,
                targetTuple,
                [0.1, 0.1, 0.1],
                ANY_QUERY_FILTER,
              )
            : null;

        if (npc.agentId !== null && result?.success) {
          const agent = state.crowd.agents[npc.agentId];
          agent.position[0] = groundPoint.x;
          agent.position[2] = groundPoint.y;
          crowdApi.requestMoveTarget(state.crowd, npc.agentId, result.nodeRef, targetTuple);
        } else {
          npc.position.copy(groundPointToVector3(groundPoint));
        }

        npc.spawns++;
        w.view.forceRender();
      },
      async spawn({ npcKey, at }) {
        if (!state.gltf) {
          throw Error("GLTF not loaded yet");
        }
        if (typeof npcKey !== "string" || !npcKeyPattern.test(npcKey)) {
          throw Error(`npcKey "${npcKey}" must match: ${npcKeyPattern}`);
        }
        if (!at) throw Error("opts.at: must exist");
        const groundPoint = parseGroundPoint(at);

        if (npcKey in state.npc) {
          state.respawn(state.npc[npcKey], groundPoint);
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

        const npc = new Npc(w, {
          key: npcKey,
          pickId,
          labelLayerIndex,
          position: groundPointToVector3(groundPoint),
          material: state.createNpcMaterial(pickId),
          labelMaterial: createLabelMaterial(state.labelTexArray, labelLayerIndex),
          skinnedMesh: clonedSkinnedMesh,
          graph,
          geometry,
        });

        if (w.nav) {
          const pos = npc.position;
          npc.agentId = crowdApi.addAgent(state.crowd, w.nav.navMesh, [pos.x, pos.y, pos.z], {
            radius: 0.2,
            height: 1.2,
            maxAcceleration: 8,
            maxSpeed: 2,
            collisionQueryRange: 1,
            separationWeight: 0.5,
            updateFlags:
              crowdApi.CrowdUpdateFlags.ANTICIPATE_TURNS |
              crowdApi.CrowdUpdateFlags.OBSTACLE_AVOIDANCE |
              crowdApi.CrowdUpdateFlags.SEPARATION,
            queryFilter: ANY_QUERY_FILTER,
          });
        }

        state.npc[npcKey] = npc;
        state.byPickId[npc.pickId] = npc;
        state.nextPickId++;

        state.update();

        if (npc.spawns++ === 0) {
          await new Promise<void>((resolve) => {
            npc.resolve = resolve;
          });
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
  if (state.gltf) {
    const anims = state.gltf.animations;
    state.clips.idle = anims.find((c) => c.name === "idle") ?? null;
    state.clips.walk = anims.find((c) => c.name === "walk") ?? null;
    state.clips.run = anims.find((c) => c.name === "run") ?? null;
  }

  useEffect(() => {
    if (import.meta.env.DEV) {
      state.devHotReload();
    }
  }, []);

  const { gltf } = state;

  return (
    gltf &&
    Object.values(state.npc).map((npc) => (
      <MemoNpcInstance key={npc.key} npc={npc} shadowMaterial={state.shadowMaterial} epoch={npc.epoch} />
    ))
  );
}

export type State = {
  byPickId: Record<number, Npc>;
  clips: { idle: THREE.AnimationClip | null; walk: THREE.AnimationClip | null; run: THREE.AnimationClip | null };
  crowd: crowdApi.Crowd;
  gltf: GLTF | null;
  labelTexArray: TexArray;
  nextPickId: number;
  shadowMaterial: THREE.MeshBasicNodeMaterial;
  texture: THREE.Texture | null;
  npc: Record<string, Npc>;

  createNpcMaterial(pickId: number): THREE.MeshStandardNodeMaterial;
  devHotReload(): void;
  move(opts: { npcKey: string; to: JshCli.PointAnyFormat }): void;
  onTick(delta: number): void;
  remove(...npcKeys: string[]): void;
  respawn(npc: Npc, groundPoint: JshCli.GroundPoint): void;
  spawn(opts: JshCli.SpawnOpts): Promise<void>;
};
