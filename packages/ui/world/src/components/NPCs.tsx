import { url } from "@npc-cli/media";
import { useStateRef } from "@npc-cli/util";

import { loadImage } from "@npc-cli/util/legacy/dom";
import { buildGraph } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import {
  ANY_QUERY_FILTER,
  createFindNearestPolyResult,
  type FindNearestPolyResult,
  findNearestPoly,
  type QueryFilter,
  type Vec3,
} from "navcat";
import { type crowd, crowd as crowdApi } from "navcat/blocks";
import { useContext, useEffect, useMemo } from "react";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cameraPosition, normalWorld, positionWorld, texture as tslTexture, uniform, uv, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { AssetsSkinManifestSchema, type AssetsSkinManifestType, type AssetsSkinType } from "../assets.schema";
import { npcLabelHeight } from "../const";
import {
  addEmptyBillboardOffset,
  createSkinnedLabelQuad,
  createSkinnedXzQuad,
  groudPointToTuple,
  groundPointToVector3,
  mergeWithGroups,
  parseGroundPoint,
} from "../service/geometry";
import { PICK_TYPE } from "../service/pick";
import { createLabelMaterial, createShadowMaterial, drawLabelLayer } from "../service/texture";
import type { PhysicsBijection } from "../worker/worker.store";
import { MemoNpcInstance } from "./NpcInstance";
import { Npc } from "./npc";
import { WorldContext } from "./world-context";

export default function NPCs() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      clips: { idle: emptyAnimationClip, walk: emptyAnimationClip, run: emptyAnimationClip },
      crowd: crowdApi.create(0.5),
      gltf: null,
      skin: {
        manifest: { byKey: {} },
        entries: [],
      },

      byPickId: {} as Record<number, Npc>,
      nextPickId: 0,
      npc: {},
      physics: { positions: [], bodyKeyToUid: {}, bodyUidToKey: {} },

      createMaterials(pickId: number, skinIndex: number) {
        const skinIndexUniform = uniform(skinIndex);
        const pickIdNode = uniform(pickId);
        const mat = new THREE.MeshStandardNodeMaterial({ alphaTest: 0.9, transparent: true });
        const texNode = tslTexture(w.texSkin.tex, uv()).depth(skinIndexUniform);
        const viewDir = cameraPosition.sub(positionWorld).normalize();
        const ndotv = normalWorld.dot(viewDir).clamp(0, 1).mul(0.4);
        mat.colorNode = vec4(texNode.rgb.mul(ndotv), texNode.a);
        mat.outputNode = w.view.withPickOutputId(PICK_TYPE.npc, pickIdNode);
        return {
          skinIndexUniform,
          material: mat,
          shadowMaterial: createShadowMaterial(w.view.objectPick),
          labelMaterial: createLabelMaterial(w.texLabel, pickId),
        };
      },
      createNpc(opts: {
        key: string;
        pickId: number;
        position: THREE.Vector3;
        skinnedMesh: THREE.SkinnedMesh;
        graph: ReturnType<typeof buildGraph>;
        geometry: THREE.BufferGeometry;
        skinIndex: number;
      }) {
        const mats = state.createMaterials(opts.pickId, opts.skinIndex);
        const npc = new Npc(w, {
          key: opts.key,
          pickId: opts.pickId,
          labelLayerIndex: opts.pickId,
          position: opts.position,
          skinnedMesh: opts.skinnedMesh,
          graph: opts.graph,
          geometry: opts.geometry,
          ...mats,
        });
        drawLabelLayer(w.texLabel, opts.pickId, opts.key);
        state.npc[opts.key] = npc;
        state.byPickId[npc.pickId] = npc;
        return npc;
      },
      devHotReload() {
        for (const oldNpc of Object.values(state.npc)) {
          oldNpc.material.dispose();
          oldNpc.labelMaterial.dispose();
          oldNpc.shadowMaterial.dispose();

          const npc = state.createNpc({
            key: oldNpc.key,
            pickId: oldNpc.pickId,
            position: oldNpc.position,
            skinnedMesh: oldNpc.skinnedMesh,
            graph: oldNpc.graph,
            geometry: oldNpc.geometry,
            skinIndex: oldNpc.skinIndex,
          });
          npc.agentId = oldNpc.agentId;
          state.placeNpcAt(npc, npc.position);
        }
        state.update();
      },
      getClosestPoly(targetPos, queryFilter = ANY_QUERY_FILTER) {
        return findNearestPoly(
          createFindNearestPolyResult(),
          w.nav.navMesh,
          groudPointToTuple(parseGroundPoint(targetPos)),
          polygonQueryHalfExtents,
          queryFilter,
        );
      },
      getSkinIndex(skinKey) {
        return state.skin.entries.findIndex((entry) => entry.key === skinKey);
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
          const agent = state.crowd.agents[npc.agentId];
          // whilst walking, doors should block npcs
          agent.queryFilter = npc.queryFilter;
          crowdApi.requestMoveTarget(state.crowd, npc.agentId, result.nodeRef, groudPointToTuple(groundPoint));
          npc.startWalking();
          npc.lastTarget = groundPoint;
          agent.separationWeight = walkSeparationWeight;
        } else {
          throw Error("move failed");
        }
      },
      onTick(delta) {
        crowdApi.update(state.crowd, w.nav.navMesh, delta);
        const { positions } = state.physics;

        for (const npc of Object.values(state.npc)) {
          npc.mixer.update(delta);

          if (npc.agentId === null) continue;

          const agent = state.crowd.agents[npc.agentId];
          npc.position.set(agent.position[0], agent.position[1], agent.position[2]);

          if (npc.moving === false) {
            // idle looks at close neighbour
            if (agent.neis.length > 0 && agent.neis[0].dist < neighborLookAtDist) {
              const neighbor = state.crowd.agents[agent.neis[0].agentId];
              npc.lookAt = { x: neighbor.position[0], y: neighbor.position[2] };
            }
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

          if (stuck === true || crowdApi.isAgentAtTarget(state.crowd, npc.agentId, 0.1) === true) {
            npc.startIdle();
            agent.separationWeight = idleSeparationWeight;
            npc.pinTo(state.getClosestPoly(npc.position));
            npc.lookAt = parseGroundPoint({
              x: npc.position.x + vx,
              y: npc.position.z + vz,
            });
          }

          const { x, y, z } = npc.position;
          positions.push(npc.bodyUid, x, y, z);
        }

        // Float32Array caused issues: decode failed
        const positions64 = new Float64Array(positions);
        w.worker.worker.postMessage({ type: "send-npc-positions", positions: positions64 }, [positions64.buffer]);
        positions.length = 0;
      },
      placeNpcAt(npc: Npc, at: JshCli.PointAnyFormat) {
        const groundPoint = parseGroundPoint(at);
        const result = state.getClosestPoly(groundPoint);
        if (result.success) {
          if (npc.agentId === null) {
            npc.agentId = crowdApi.addAgent(
              state.crowd,
              w.nav.navMesh,
              groudPointToTuple(groundPoint),
              getAgentParams(),
            );
          }
          const agent = state.crowd.agents[npc.agentId];
          // can teleport past closed doors
          agent.queryFilter = ANY_QUERY_FILTER;
          npc.pinTo(result);
          agent.position[0] = groundPoint.x;
          agent.position[2] = groundPoint.y;

          // might have spawned into a sensor
          state.physics.positions.push(npc.bodyUid, ...agent.position);
        } else {
          if (npc.agentId !== null) {
            crowdApi.removeAgent(state.crowd, npc.agentId);
            npc.agentId = null;
          }
          npc.position.copy(groundPointToVector3(groundPoint));
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
        w.events.next({ key: "removed-npcs", npcKeys });
      },
      async spawn({ npcKey, at, as }) {
        if (typeof npcKey !== "string" || !npcKeyPattern.test(npcKey)) {
          throw Error(`npcKey must match: ${npcKeyPattern}`);
        }
        if (!at) {
          throw Error("opts.at: must exist");
        }

        // 🔔 would prefer not to reference `w.e`
        const gmRoomId = w.e.findRoomContaining(at, true);
        if (gmRoomId === null) {
          throw Error(`must be in some room`);
        }

        if (npcKey in state.npc) {
          const npc = state.npc[npcKey];
          state.placeNpcAt(npc, at);
          npc.spawns++;
          if (as) npc.changeSkin(as);

          w.view.forceUpdate();
        } else {
          const clone = SkeletonUtils.clone((state.gltf as GLTF).scene);
          const graph = buildGraph(clone);
          const clonedSkinnedMesh = graph.nodes.root as THREE.SkinnedMesh;
          const headBoneIndex = clonedSkinnedMesh.skeleton.bones.findIndex((b) => b.name === "head");

          const shadowQuad = createSkinnedXzQuad(1, 1);
          const labelQuad = createSkinnedLabelQuad(0.5, 0.125, npcLabelHeight, headBoneIndex >= 0 ? headBoneIndex : 0);
          addEmptyBillboardOffset(clonedSkinnedMesh.geometry);
          addEmptyBillboardOffset(shadowQuad);
          const geometry = mergeWithGroups(clonedSkinnedMesh.geometry, shadowQuad, labelQuad);

          const npc = state.createNpc({
            key: npcKey,
            pickId: state.nextPickId,
            position: groundPointToVector3(parseGroundPoint(at)),
            skinnedMesh: clonedSkinnedMesh,
            graph,
            geometry,
            skinIndex: state.getSkinIndex(as ?? "medic-0"),
          });

          state.placeNpcAt(npc, at);
          npc.spawns = 1;
          state.nextPickId++;

          state.update();
          await new Promise<void>((resolve) => (npc.resolve = resolve));
        }

        w.events.next({ key: "spawned", npcKey, gmRoomId });
      },
    }),
  );

  w.npc = state;

  const queryData =
    useQuery({
      queryKey: [...w.worldQueryPrefix, "skins-and-gltf"],
      queryFn: async () => {
        const [gltf, skin] = await Promise.all([
          new GLTFLoader().loadAsync(url.templateTest0Gltf),
          (async () => {
            const res = await fetch("/skin/manifest.json");
            const manifest = AssetsSkinManifestSchema.parse(await res.json());
            const entries = Object.values(manifest.byKey);
            const images = await Promise.all(entries.map((entry) => loadImage(`/skin/${entry.filename}`)));
            entries.forEach((_entry, i) => {
              w.texSkin.ct.clearRect(0, 0, 64, 64);
              w.texSkin.ct.drawImage(images[i], 0, 0, 64, 64);
              w.texSkin.updateIndex(i);
            });
            return { manifest, entries: Object.values(manifest.byKey) };
          })(),
        ]);
        return { gltf, skin };
      },
      // staleTime: Infinity,
    }).data ?? null;

  useMemo(() => {
    if (!queryData) return;
    state.gltf = queryData.gltf;
    const anims = queryData.gltf.animations;
    state.clips.idle = anims.find((c) => c.name === "idle") ?? emptyAnimationClip;
    state.clips.walk = anims.find((c) => c.name === "walk") ?? emptyAnimationClip;
    state.clips.run = anims.find((c) => c.name === "run") ?? emptyAnimationClip;
    state.skin = queryData.skin;
  }, [queryData]);

  useEffect(() => void (import.meta.env.DEV && state.devHotReload()), []);

  return state.gltf && Object.values(state.npc).map((npc) => <MemoNpcInstance key={npc.key} npc={npc} />);
}

export type State = {
  clips: { idle: THREE.AnimationClip; walk: THREE.AnimationClip; run: THREE.AnimationClip };
  crowd: crowdApi.Crowd;
  gltf: GLTF | null;
  skin: {
    manifest: AssetsSkinManifestType;
    entries: AssetsSkinType[];
  };

  byPickId: Record<number, Npc>;
  nextPickId: number;
  npc: Record<string, Npc>;
  physics: { positions: number[] } & PhysicsBijection;

  createMaterials(
    pickId: number,
    skinIndex: number,
  ): {
    skinIndexUniform: ReturnType<typeof uniform<number>>;
    material: THREE.MeshStandardNodeMaterial;
    shadowMaterial: THREE.MeshBasicNodeMaterial;
    labelMaterial: THREE.MeshBasicNodeMaterial;
  };
  createNpc(opts: {
    key: string;
    pickId: number;
    position: THREE.Vector3;
    skinnedMesh: THREE.SkinnedMesh;
    graph: ReturnType<typeof buildGraph>;
    geometry: THREE.BufferGeometry;
    skinIndex: number;
  }): Npc;
  placeNpcAt(npc: Npc, at: JshCli.PointAnyFormat): void;
  devHotReload(): void;
  getClosestPoly(targetPos: JshCli.PointAnyFormat, queryFilter?: QueryFilter): FindNearestPolyResult;
  getSkinIndex(skinKey: string): number;
  move(opts: { npcKey: string; to: JshCli.PointAnyFormat }): void;
  onTick(delta: number): void;
  remove(...npcKeys: string[]): void;
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

const npcKeyPattern = /^[a-z][a-z0-9-]*$/;
const idleSeparationWeight = 0.5;
const walkSeparationWeight = 0.25;
const neighborLookAtDist = 0.25;
const closePolygonDistance = 0.05;
const polygonQueryHalfExtents: Vec3 = [closePolygonDistance, 0.05, closePolygonDistance];

const emptyAnimationClip = new THREE.AnimationClip();
emptyAnimationClip.name = "empty-animation-clip";
