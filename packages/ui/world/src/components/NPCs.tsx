import { url } from "@npc-cli/media";
import { useStateRef } from "@npc-cli/util";

import { loadImage } from "@npc-cli/util/legacy/dom";
import { buildGraph } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import {
  ANY_QUERY_FILTER,
  createDefaultQueryFilter,
  createFindNearestPolyResult,
  type FindNearestPolyResult,
  findNearestPoly,
  getNodeByRef,
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
import { npcScale } from "../const";
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
import { PICK_TYPE } from "../service/pick";
import { createLabelMaterial, createShadowMaterial, drawLabelLayer } from "../service/texture";
import { decodeDoorAreaId, isDoorAreaId } from "../worker/nav-util";
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
      doorsQueryFilter: {
        ...createDefaultQueryFilter(),
        passFilter(nodeRef, navMesh) {
          const node = getNodeByRef(navMesh, nodeRef);

          // 🚧 faster via w.npc.doorAreaOpen
          if (isDoorAreaId(node.area) === true) {
            const decoded = decodeDoorAreaId(node.area);
            return w.door.isOpen(decoded.gmId, decoded.doorId);
          }

          return true;
        },
      },
      nextPickId: 0,
      npc: {},

      createMaterials(pickId: number, skinIndex: number) {
        const skinIndexUniform = uniform(skinIndex);
        const pickIdNode = uniform(pickId);
        const mat = new THREE.MeshStandardNodeMaterial({ alphaTest: 0.9, transparent: true });
        const texNode = tslTexture(w.texSkin.tex, uv()).depth(skinIndexUniform);
        const viewDir = cameraPosition.sub(positionWorld).normalize();
        const ndotv = normalWorld.dot(viewDir).clamp(0, 1).mul(0.8);
        mat.colorNode = vec4(texNode.rgb.mul(ndotv), texNode.a).add(0);
        mat.outputNode = w.view.withPickOutputId(PICK_TYPE.npc, pickIdNode);
        return {
          skinIndexUniform,
          material: mat,
          shadowMaterial: createShadowMaterial(w.view.objectPick),
          labelMaterial: createLabelMaterial(w.texLabel, pickId),
        };
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
        } else {
          if (npc.agentId !== null) {
            crowdApi.removeAgent(state.crowd, npc.agentId);
            npc.agentId = null;
          }
          npc.position.copy(groundPointToVector3(groundPoint));
        }
      },
      devHotReload() {
        for (const [key, oldNpc] of Object.entries(state.npc)) {
          oldNpc.material.dispose();
          oldNpc.labelMaterial.dispose();
          oldNpc.shadowMaterial.dispose();

          const mats = state.createMaterials(oldNpc.pickId, oldNpc.skinIndex);
          const npc = new Npc(w, {
            key: oldNpc.key,
            pickId: oldNpc.pickId,
            labelLayerIndex: oldNpc.labelLayerIndex,
            position: oldNpc.position,
            skinnedMesh: oldNpc.skinnedMesh,
            graph: oldNpc.graph,
            geometry: oldNpc.geometry,
            ...mats,
          });

          // if (oldNpc.agentId !== null) {
          //   crowdApi.removeAgent(state.crowd, oldNpc.agentId);
          //   oldNpc.agentId = null;
          // }
          npc.agentId = oldNpc.agentId;
          state.placeNpcAt(npc, npc.position);

          drawLabelLayer(w.texLabel, npc.labelLayerIndex, npc.key);
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
          // whilst walking doors should block npcs
          agent.queryFilter = state.doorsQueryFilter;
          crowdApi.requestMoveTarget(state.crowd, npc.agentId, result.nodeRef, groudPointToTuple(groundPoint));
          npc.startWalking();
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
      async spawn({ npcKey, at, as }) {
        if (typeof npcKey !== "string" || !npcKeyPattern.test(npcKey)) {
          throw Error(`npcKey must match: ${npcKeyPattern}`);
        }
        if (!at) {
          throw Error("opts.at: must exist");
        }

        if (npcKey in state.npc) {
          const npc = state.npc[npcKey];
          npc.spawns++;
          state.placeNpcAt(npc, at);
          if (as) npc.changeSkin(as);
          w.view.forceUpdate();
          return;
        }

        const clone = SkeletonUtils.clone((state.gltf as GLTF).scene);
        const graph = buildGraph(clone);
        const clonedSkinnedMesh = graph.nodes.root as THREE.SkinnedMesh;
        const headBoneIndex = clonedSkinnedMesh.skeleton.bones.findIndex((b) => b.name === "head");

        const shadowQuad = createSkinnedXzQuad(1, 1);
        const labelQuad = createSkinnedLabelQuad(0.5, 0.125, 1.25 / npcScale, headBoneIndex >= 0 ? headBoneIndex : 0);
        addEmptyBillboardOffset(clonedSkinnedMesh.geometry);
        addEmptyBillboardOffset(shadowQuad);
        const geometry = mergeWithGroups(clonedSkinnedMesh.geometry, shadowQuad, labelQuad);

        const pickId = state.nextPickId;
        drawLabelLayer(w.texLabel, pickId, npcKey);

        const mats = state.createMaterials(pickId, state.getSkinIndex(as ?? "medic-0"));
        const npc = new Npc(w, {
          key: npcKey,
          pickId,
          labelLayerIndex: pickId,
          position: groundPointToVector3(parseGroundPoint(at)),
          skinnedMesh: clonedSkinnedMesh,
          graph,
          geometry,
          ...mats,
        });

        state.placeNpcAt(npc, at);

        state.npc[npcKey] = npc;
        state.byPickId[npc.pickId] = npc;
        state.nextPickId++;

        state.update();
        await new Promise<void>((resolve) => (npc.resolve = resolve));
      },
    }),
    { reset: { doorsQueryFilter: false } },
  );

  w.npc = state;

  const queryData =
    useQuery({
      queryKey: [...w.worldQueryPrefix, "template-gltf"],
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
      staleTime: Infinity,
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

  return (
    state.gltf && Object.values(state.npc).map((npc) => <MemoNpcInstance key={npc.key} npc={npc} epoch={npc.epoch} />)
  );
}

export type State = {
  byPickId: Record<number, Npc>;
  doorsQueryFilter: QueryFilter;
  clips: { idle: THREE.AnimationClip; walk: THREE.AnimationClip; run: THREE.AnimationClip };
  crowd: crowdApi.Crowd;
  gltf: GLTF | null;
  nextPickId: number;
  skin: {
    manifest: AssetsSkinManifestType;
    entries: AssetsSkinType[];
  };

  npc: Record<string, Npc>;

  createMaterials(
    pickId: number,
    skinIndex: number,
  ): {
    skinIndexUniform: ReturnType<typeof uniform<number>>;
    material: THREE.MeshStandardNodeMaterial;
    shadowMaterial: THREE.MeshBasicNodeMaterial;
    labelMaterial: THREE.MeshBasicNodeMaterial;
  };
  placeNpcAt(npc: Npc, at: JshCli.PointAnyFormat): void;
  devHotReload(): void;
  findGmIdContaining(input: MaybeMeta<JshCli.PointAnyFormat>): number | null;
  findRoomContaining(point: MaybeMeta<JshCli.PointAnyFormat>, includeDoors?: boolean): null | Geomorph.GmRoomId;
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
const closePolygonDistance = 0.05;
const polygonQueryHalfExtents: Vec3 = [closePolygonDistance, 0.05, closePolygonDistance];

const emptyAnimationClip = new THREE.AnimationClip();
emptyAnimationClip.name = "empty-animation-clip";
