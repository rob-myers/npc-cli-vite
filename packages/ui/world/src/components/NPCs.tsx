import { url } from "@npc-cli/media";
import { useStateRef } from "@npc-cli/util";
import { getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { buildGraph } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import { ANY_QUERY_FILTER, createFindNearestPolyResult, type FindNearestPolyResult, findNearestPoly } from "navcat";
import { type crowd, crowd as crowdApi } from "navcat/blocks";
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
  groudPointToTuple,
  groundPointToVector3,
  mergeWithGroups,
  parseGroundPoint,
} from "../service/geometry";
import { helper } from "../service/helper";
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
      crowd: crowdApi.create(0.5),
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

        for (const [key, oldNpc] of Object.entries(state.npc)) {
          oldNpc.material.dispose();
          oldNpc.labelMaterial.dispose();

          const npc = new Npc(w, {
            key: oldNpc.key,
            pickId: oldNpc.pickId,
            labelLayerIndex: oldNpc.labelLayerIndex,
            position: oldNpc.position,
            material: state.createNpcMaterial(oldNpc.pickId),
            labelMaterial: createLabelMaterial(state.labelTexArray, oldNpc.labelLayerIndex),
            skinnedMesh: oldNpc.skinnedMesh,
            graph: oldNpc.graph,
            geometry: oldNpc.geometry,
          });

          if (oldNpc.agentId !== null) {
            crowdApi.removeAgent(state.crowd, oldNpc.agentId);
            npc.agentId = crowdApi.addAgent(
              state.crowd,
              w.nav.navMesh,
              groudPointToTuple(parseGroundPoint(npc.position)),
              getAgentParams(),
            );
            npc.pinTo(state.getClosestPoly(npc.position));
          }

          drawLabelLayer(state.labelTexArray, npc.labelLayerIndex, npc.key);
          state.npc[key] = npc;
          state.byPickId[npc.pickId] = npc;
        }
        state.update();
      },
      findGmIdContaining(input) {
        if (typeof input.meta?.gmId === "number") {
          return input.meta.gmId;
        }
        return w.gmGraph.findGmIdContaining(parseGroundPoint(input));
      },
      findRoomContaining(input, includeDoors = false) {
        if (helper.isGmRoomId(input.meta) === true) {
          // 🔔 existing input.meta overrides includeDoors `false`
          return { ...input.meta };
        }
        const gmId = state.findGmIdContaining(input);
        if (typeof gmId === "number") {
          const point = parseGroundPoint(input);
          const gm = w.gms[gmId];
          const localPoint = gm.inverseMatrix.transformPoint({ x: point.x, y: point.y });
          const roomId = w.gmsData.findRoomIdContaining(gm, localPoint, includeDoors);
          return roomId === null ? null : { gmId, roomId, grKey: helper.getGmRoomKey(gmId, roomId) };
        } else {
          return null;
        }
      },
      getClosestPoly(targetPos) {
        return findNearestPoly(
          createFindNearestPolyResult(),
          w.nav.navMesh,
          groudPointToTuple(parseGroundPoint(targetPos)),
          [closePolygonDistance, 0.05, closePolygonDistance],
          ANY_QUERY_FILTER, // permits doorways
        );
      },
      move({ npcKey, to }) {
        const npc = state.npc[npcKey];

        if (typeof npcKey !== "string" || !npc) {
          throw Error(`opts.npcKey must exist: saw ${npcKey}`);
        }
        if (npc.agentId === null) {
          throw Error(`npc has no agent: ${npcKey}`);
        }

        const groundPoint = parseGroundPoint(to);
        const result = state.getClosestPoly(groundPoint);

        if (result.success) {
          crowdApi.requestMoveTarget(state.crowd, npc.agentId, result.nodeRef, groudPointToTuple(groundPoint));
          npc.startWalking();
          const agent = state.crowd.agents[npc.agentId];
          agent.separationWeight = walkSeparationWeight;
        } else {
          throw Error("move failed");
        }
      },
      onTick(delta) {
        crowdApi.update(state.crowd, w.nav.navMesh, delta);

        for (const npc of Object.values(state.npc)) {
          npc.mixer.update(delta);

          if (npc.agentId === null) continue;

          const agent = state.crowd.agents[npc.agentId];
          npc.position.set(agent.position[0], agent.position[1], agent.position[2]);

          if (npc.moving === false) {
            npc.updateLookAt(delta);
            continue;
          }

          const [vx, , vz] = agent.velocity;
          const speed = Math.hypot(vx, vz);
          npc.syncAnimation(Math.max(speed, 0.5));

          if (speed > 0.05) {
            npc.smoothRotateToward(vx, vz, delta);
          }

          const stuck = npc.updateStuck(delta);

          // 🚧 npc.setIdle()
          if (stuck === true || crowdApi.isAgentAtTarget(state.crowd, npc.agentId, 0.1) === true) {
            npc.startIdle();
            agent.separationWeight = idleSeparationWeight;
            npc.pinTo(state.getClosestPoly(npc.position));
            npc.lookAt = parseGroundPoint({
              x: npc.position.x + vx,
              y: npc.position.z + vz,
            });
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
      respawn(npc, at) {
        const groundPoint = parseGroundPoint(at);
        const result = state.getClosestPoly(groundPoint);

        // npc has agent iff near navmesh
        if (result.success && npc.agentId === null) {
          npc.agentId = crowdApi.addAgent(state.crowd, w.nav.navMesh, groudPointToTuple(groundPoint), getAgentParams());
        } else if (result.success === false && npc.agentId !== null) {
          crowdApi.removeAgent(state.crowd, npc.agentId);
          npc.agentId = null;
        }

        npc.pinTo(result); // needs agentId

        // teleport
        if (npc.agentId !== null) {
          const agent = state.crowd.agents[npc.agentId];
          agent.position[0] = groundPoint.x;
          agent.position[2] = groundPoint.y;
        } else {
          npc.position.copy(groundPointToVector3(groundPoint));
        }

        npc.spawns++;
        w.view.forceUpdate();
      },
      async spawn({ npcKey, at }) {
        if (typeof npcKey !== "string" || !npcKeyPattern.test(npcKey)) {
          throw Error(`npcKey must match: ${npcKeyPattern}`);
        }
        if (!at) {
          throw Error("opts.at: must exist");
        }

        if (npcKey in state.npc) {
          state.respawn(state.npc[npcKey], at);
          return;
        }

        const groundPoint = parseGroundPoint(at);

        const clone = SkeletonUtils.clone(state.gltf!.scene);
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

        const result = state.getClosestPoly(at);
        if (result.success === true) {
          npc.agentId = crowdApi.addAgent(state.crowd, w.nav.navMesh, groudPointToTuple(groundPoint), getAgentParams());
          npc.pinTo(result);
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

  useEffect(() => void (import.meta.env.DEV && state.devHotReload()), []);

  return (
    state.gltf &&
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
  findGmIdContaining(input: MaybeMeta<JshCli.PointAnyFormat>): number | null;
  findRoomContaining(point: MaybeMeta<JshCli.PointAnyFormat>, includeDoors?: boolean): null | Geomorph.GmRoomId;
  getClosestPoly(targetPos: JshCli.PointAnyFormat): FindNearestPolyResult;
  move(opts: { npcKey: string; to: JshCli.PointAnyFormat }): void;
  onTick(delta: number): void;
  remove(...npcKeys: string[]): void;
  respawn(npc: Npc, at: JshCli.PointAnyFormat): void;
  spawn(opts: JshCli.SpawnOpts): Promise<void>;
};

function getAgentParams(): crowd.AgentParams {
  return {
    radius: 0.2,
    height: 1.2,
    maxAcceleration: 8.0,
    maxSpeed: 1.5,
    collisionQueryRange: 0.75,
    separationWeight: idleSeparationWeight,
    updateFlags:
      crowdApi.CrowdUpdateFlags.ANTICIPATE_TURNS |
      crowdApi.CrowdUpdateFlags.SEPARATION |
      crowdApi.CrowdUpdateFlags.OBSTACLE_AVOIDANCE,
    // crowdApi.CrowdUpdateFlags.OPTIMIZE_TOPO |
    // crowdApi.CrowdUpdateFlags.OPTIMIZE_VIS,
    queryFilter: ANY_QUERY_FILTER,
  };
}

const idleSeparationWeight = 0.5;
const walkSeparationWeight = 0.25;

const closePolygonDistance = 0.05;
