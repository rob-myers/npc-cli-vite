import { url } from "@npc-cli/media";
import { useStateRef } from "@npc-cli/util";

import { getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
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
import { AssetsSkinManifestSchema, type AssetsSkinManifestType, type SkinSheetEntry } from "../assets.schema";
import { idleSeparationWeight, npcBrightness, npcLabelHeight, runAgentMaxSpeed, walkAgentMaxSpeed } from "../const";
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
import { createLabelMaterial, createShadowMaterial, drawLabelLayer, fetchSkinOverlay } from "../service/texture";
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
        manifest: { byKey: {} } as AssetsSkinManifestType,
        entries: [] as SkinSheetEntry[],
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
        const ndotv = normalWorld.dot(viewDir).clamp(0, 1).mul(npcBrightness);
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
          npc.doorKeys = oldNpc.doorKeys;
          npc.last = oldNpc.last;
          npc.bubbleOffset = oldNpc.bubbleOffset;
          npc.mixer = oldNpc.mixer;

          state.placeNpcAt(npc, npc.position);
        }
        state.update();
      },
      get(npcKey) {
        const npc = state.npc[npcKey];
        if (npc === undefined) {
          throw Error(`npc "${npcKey}" does not exist`);
        } else {
          return npc;
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
      async move({ npcKey, to }) {
        const npc = state.npc[npcKey];

        if (typeof npcKey !== "string" || !npc) {
          throw Error(`opts.npcKey must exist: saw ${npcKey}`);
        }
        if (npc.agentId === null) {
          throw Error(`npc has no agent: ${npcKey}`);
        }

        const groundPoint = parseGroundPoint(to);
        const result = state.getClosestPoly(groundPoint);

        if (!result.success) {
          throw Error("move failed");
        }

        npc.reject?.(new Error("move again"));

        npc.startMoving(groundPoint, result);
        w.events.next({ key: "started-moving", npcKey });

        try {
          await npc.waitUntilResolved();
        } catch (e) {
          if (e instanceof Error && e.message === "move again") {
            return;
          } else {
            npc.startIdle();
            throw e;
          }
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

          agent.maxSpeed = npc.running === true ? runAgentMaxSpeed : walkAgentMaxSpeed;
          const [vx, , vz] = agent.velocity;
          const speed = Math.hypot(vx, vz);
          npc.syncAnimation(Math.max(speed, 0.5));

          if (speed > 0.05) {
            npc.smoothRotateToward(vx, vz, delta);
          }

          const stuck = npc.updateStuck(delta);

          if (stuck === true || crowdApi.isAgentAtTarget(state.crowd, npc.agentId, 0.1) === true) {
            npc.startIdle();
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
          npc.reject?.(new Error("removed npc"));
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
          await new Promise<string>((resolve) => (npc.resolve = resolve));
        }

        w.events.next({ key: "spawned", npcKey, gmRoomId });
      },
    }),
  );

  w.npc = state;
  w.n = state.npc;

  const queryData =
    useQuery({
      queryKey: [...w.worldQueryPrefix, "skins-and-gltf"],
      queryFn: async () => {
        // 🚧 stale on hmr so apply fix

        const cacheBust = getDevCacheBustQueryParam();
        const [gltf, sheetImages, { manifest: skinManifest, skinKeyToSvgOverride }] = await Promise.all([
          new GLTFLoader().loadAsync(url.extraRootThinnerGltf),
          Promise.all(w.sheets.skinSheetDims.map((_, i) => loadImage(`/sheet/skin.${i}.png${cacheBust}`))),
          fetch(`/skin/manifest.json${cacheBust}`).then(async (r) => {
            /**
             * Faster hot-reloads than if we applied SVG overlays to spritesheet.
             */
            const manifest = AssetsSkinManifestSchema.parse(await r.json());
            return {
              manifest,
              skinKeyToSvgOverride: Object.fromEntries(
                await Promise.all(
                  Object.entries(manifest.byKey).map(
                    async ([key, { svgPath }]) =>
                      [key, svgPath ? await fetchSkinOverlay(svgPath, cacheBust) : null] as const,
                  ),
                ),
              ),
            };
          }),
        ]);

        const skinEntries = Object.values(w.sheets.skin);
        const { width: tw, height: th } = w.texSkin.opts;
        w.texSkin.ct.imageSmoothingEnabled = false;
        skinEntries.forEach(({ sheetId, rect }, i) => {
          w.texSkin.ct.clearRect(0, 0, tw, th);

          const svgImage = skinKeyToSvgOverride[skinEntries[i].key];

          if (svgImage) {
            w.texSkin.ct.drawImage(svgImage, 0, 0, tw, th);
          } else {
            w.texSkin.ct.drawImage(sheetImages[sheetId], rect.x, rect.y, rect.width, rect.height, 0, 0, tw, th);
          }

          w.texSkin.updateIndex(i);
        });
        return { gltf, skinEntries, skinManifest };
      },
      gcTime: 0,
    }).data ?? null;

  useMemo(() => {
    if (!queryData) return;
    state.gltf = queryData.gltf;
    const anims = queryData.gltf.animations;
    state.clips.idle = anims.find((c) => c.name === "idle") ?? emptyAnimationClip;
    state.clips.walk = anims.find((c) => c.name === "walk") ?? emptyAnimationClip;
    state.clips.run = anims.find((c) => c.name === "run") ?? emptyAnimationClip;
    state.skin = { entries: queryData.skinEntries, manifest: queryData.skinManifest };
    w.setNextPending({ skins: false });
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
    entries: SkinSheetEntry[];
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
  get(npcKey: string): Npc;
  getSkinIndex(skinKey: string): number;
  move(opts: { npcKey: string; to: JshCli.PointAnyFormat }): Promise<void>;
  onTick(delta: number): void;
  remove(...npcKeys: string[]): void;
  spawn(opts: JshCli.SpawnOpts): Promise<void>;
};

function getAgentParams(): crowd.AgentParams {
  return {
    radius: 0.2,
    height: 1.2,
    maxAcceleration: 8.0,
    maxSpeed: walkAgentMaxSpeed,
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
const neighborLookAtDist = 0.25;
const closePolygonDistance = 0.05;
const polygonQueryHalfExtents: Vec3 = [closePolygonDistance, 0.05, closePolygonDistance];

const emptyAnimationClip = new THREE.AnimationClip();
emptyAnimationClip.name = "empty-animation-clip";
