import { url } from "@npc-cli/media";
import { geomService, useStateRef } from "@npc-cli/util";

import { getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { loadImage } from "@npc-cli/util/legacy/dom";
import { keys, mapValues } from "@npc-cli/util/legacy/generic";
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
import {
  defaultIdleAnimationClipKey,
  fromAnimationClipKey,
  idleAgentMaxSpeed,
  idleSeparationWeight,
  npcBrightness,
  npcLabelHeight,
  runAgentMaxSpeed,
  walkAgentMaxSpeed,
  walkMaxAcceleration,
} from "../const";
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
import { crossFadeSynchronized, emptyAnimationClip } from "../service/three-animation";
import type { PhysicsBijection } from "../worker/worker.store";
import { MemoNpcInstance } from "./NpcInstance";
import { Npc } from "./npc";
import { WorldContext } from "./world-context";

export default function NPCs() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      clips: mapValues(fromAnimationClipKey, () => emptyAnimationClip),
      crowd: crowdApi.create(0.5),
      gltf: null,
      skin: {
        manifest: { byKey: {} } as AssetsSkinManifestType,
        entries: [] as SkinSheetEntry[],
      },
      lastHmr: 0,

      byPickId: {} as Record<number, Npc>,
      nextPickId: 0,
      npc: {},
      physics: { positions: [], bodyKeyToUid: {}, bodyUidToKey: {} },

      configureCrowd() {
        // improve initial path accuracy
        state.crowd.quickSearchIterations = 50;
      },
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
          npc.moveClip = oldNpc.moveClip;
          npc.idleClip = oldNpc.idleClip;
          npc.spawns = oldNpc.spawns;

          state.placeNpcAt(npc, npc.position, w.e.npcToDoable[npc.key] ? "doable" : "navigable");
        }
        state.update();
      },
      findFreeDoMeta(meta, npcKey) {
        if (typeof meta.do === "string") {
          const otherNpcKey = w.e.doableToNpc[meta.key];
          if (otherNpcKey && otherNpcKey !== npcKey) throw Error("not doable");
          return meta;
        }

        if (meta.obstacle === true && Array.isArray(meta.decorIds)) {
          const gm = w.gms[meta.gmId];
          const ds = (meta.decorIds as number[]).map((decorId) => gm.decor[decorId] as Geomorph.DecorPoint);
          const found = ds.find((d) => !w.e.doableToNpc[d.key] || w.e.doableToNpc[d.key] === npcKey) ?? null;
          if (!found) throw Error("not doable");
          return found.meta;
        }

        // not doable
        return null;
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
        const targetTuple = groudPointToTuple(parseGroundPoint(targetPos));
        const result = findNearestPoly(
          createFindNearestPolyResult(),
          w.nav.navMesh,
          targetTuple,
          closePolygonHalfExtents,
          queryFilter,
        );
        if (result.success === true) {
          // 🔔 force fail when XZ distance exceeds half extent
          const dist = Math.hypot(result.position[0] - targetTuple[0], result.position[2] - targetTuple[2]);
          result.success = dist <= closePolygonDistance;
        }
        return result;
      },
      getSkinIndex(skinKey) {
        return state.skin.entries.findIndex((entry) => entry.key === skinKey);
      },
      async move({ npcKey, to, arrive = true }) {
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
          throw Error("not navigable");
        }

        npc.reject?.(new Error("move again"));

        npc.startMoving(groundPoint, result, arrive);
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
        const worldSeconds = w.timer.getElapsedTime();

        for (const npc of Object.values(state.npc)) {
          npc.mixer.update(delta);

          if (npc.agentId === null) continue;

          const agent = state.crowd.agents[npc.agentId];
          npc.position.x = agent.position[0];
          npc.position.z = agent.position[2];

          if (npc.moving === false) {
            npc.updateIdle(agent, delta, worldSeconds);
            continue;
          }

          agent.maxSpeed = npc.running === true ? runAgentMaxSpeed : walkAgentMaxSpeed;
          const [vx, , vz] = agent.velocity;
          const speed = Math.hypot(vx, vz);
          npc.syncAnimation(Math.max(speed, 0.5));

          if (speed > 0.05) {
            npc.smoothRotateToward(vx, vz, delta);
          }

          const stuck = npc.updateStuck(delta, worldSeconds);
          if (stuck === true) {
            npc.startIdle();
          } else if (
            crowdApi.isAgentAtTarget(state.crowd, npc.agentId, npc.arrive ? 0.15 : npc.running ? 0.8 : 0.4) === true
          ) {
            // arrived
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
      placeNpcAt(npc, at, type) {
        const groundPoint = parseGroundPoint(at);
        const result = state.getClosestPoly(groundPoint);
        if (result.success) {
          // always remove agent so can teleport without issues
          if (npc.agentId !== null) {
            crowdApi.removeAgent(state.crowd, npc.agentId);
            npc.agentId = null;
          }
          npc.agentId = crowdApi.addAgent(state.crowd, w.nav.navMesh, groudPointToTuple(groundPoint), getAgentParams());

          npc.pinTo(result);

          // might have spawned into a sensor
          const agent = state.crowd.agents[npc.agentId];
          state.physics.positions.push(npc.bodyUid, ...agent.position);
        } else if (type === "navigable") {
          throw Error("not placable");
        } else {
          if (npc.agentId !== null) {
            crowdApi.removeAgent(state.crowd, npc.agentId);
            npc.agentId = null;
          }
          npc.position.x = groundPoint.x;
          npc.position.z = groundPoint.y;
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
          w.e.setNpcDo(npcKey, null);
          npc.reject?.(new Error("removed npc"));
        }
        if (Object.keys(state.npc).length === 0) {
          state.nextPickId = 0;
        }
        state.update();
        w.events.next({ key: "removed-npcs", npcKeys });
      },
      async spawn({ npcKey, at, as, angle, facing }) {
        if (typeof npcKey !== "string" || !npcKeyPattern.test(npcKey)) {
          throw Error(`npcKey must match: ${npcKeyPattern}`);
        }
        if (!at) {
          throw Error("opts.at: must exist");
        }

        const groundAt = parseGroundPoint(at);
        const gmRoomId = w.e.findRoomContaining(at, true);
        if (gmRoomId === null) throw Error("must be in some room");

        if (facing) {
          facing = parseGroundPoint(facing);
          angle = geomService.getThreeRotationY(facing.y - groundAt.y, facing.x - groundAt.x);
        } else if (angle !== undefined) {
          // absorb errors else npc disappears
          angle = Number(angle) || 0;
        }

        let npc = state.npc[npcKey];

        if (!npc) {
          const clone = SkeletonUtils.clone((state.gltf as GLTF).scene);
          const graph = buildGraph(clone);
          const clonedSkinnedMesh = graph.nodes.root as THREE.SkinnedMesh;

          const shadowQuad = createSkinnedXzQuad(1, 1);
          // const headBoneIndex = clonedSkinnedMesh.skeleton.bones.findIndex((b) => b.name === "head");
          const labelQuad = createSkinnedLabelQuad(0.5, 0.125, npcLabelHeight, 0);
          addEmptyBillboardOffset(clonedSkinnedMesh.geometry);
          addEmptyBillboardOffset(shadowQuad);
          const geometry = mergeWithGroups(clonedSkinnedMesh.geometry, shadowQuad, labelQuad);

          npc = state.createNpc({
            key: npcKey,
            pickId: state.nextPickId++,
            position: groundPointToVector3(groundAt),
            skinnedMesh: clonedSkinnedMesh,
            graph,
            geometry,
            skinIndex: state.getSkinIndex(as ?? "medic-0"),
          });
        }

        const doMeta = state.findFreeDoMeta(at?.meta ?? {}, npcKey);
        if (doMeta !== null) {
          state.placeNpcAt(npc, doMeta.groundPoint, "doable");
          npc.idleClip = state.clips[metaToIdleAnimationClipKey(doMeta)];
          w.e.setNpcDo(npcKey, doMeta.key);
        } else {
          state.placeNpcAt(npc, at, "navigable");
          npc.idleClip = state.clips.idle;
          w.e.setNpcDo(npcKey, null);
        }

        if (npc.spawns++ === 0) {
          await new Promise<string>((resolve) => {
            npc.resolve = resolve;
            state.update();
          });
          npc.playIdleClip(0); // after mount
        } else {
          if (as) npc.changeSkin(as);
          npc.playIdleClip(0); // before update
          w.view.forceUpdate();
        }

        npc.skinnedMesh.position.y = doMeta?.y ?? 0;
        if (typeof doMeta?.orient === "number") {
          angle = -(doMeta.orient + 90) * (Math.PI / 180);
        }
        if (typeof angle === "number") {
          npc.skinnedMesh.rotation.y = angle;
        }

        w.events.next({ key: "spawned", npcKey, gmRoomId });
      },
    }),
  );

  w.npc = state;
  w.n = state.npc;

  const queryData =
    useQuery({
      queryKey: [...w.worldQueryPrefix, "skins-and-gltf", state.lastHmr],
      queryFn: async () => {
        if (import.meta.hot?.data.__JUST_HMR_NPCS__) {
          import.meta.hot.data.__JUST_HMR_NPCS__ = false;
          state.set({ lastHmr: Date.now() });
          return null; // ignore 1st stale invoke after HMR
        }

        const cacheBust = getDevCacheBustQueryParam();
        const [gltf, sheetImages, { manifest: skinManifest, skinKeyToSvgOverride }] = await Promise.all([
          // new GLTFLoader().loadAsync(url.extraRootThinnerGltf),
          // new GLTFLoader().loadAsync(url.templateMoreAnimsGltf),
          new GLTFLoader().loadAsync(url.templateMoreAnimsWipGltf),
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
    state.configureCrowd();

    if (!queryData) return;
    state.gltf = queryData.gltf;
    const anims = queryData.gltf.animations;

    /** 🔔 on new clips fade old ones, else hmr can break animations */
    const clips = mapValues(
      fromAnimationClipKey,
      (_, clipName) => anims.find((c) => c.name === clipName) ?? emptyAnimationClip,
    );
    const pairedClips = keys(clips).map((clipName) => [state.clips[clipName], clips[clipName]] as const);
    for (const npc of Object.values(state.npc)) {
      npc.moveClip = clips[npc.moveClip.name as AnimationClipKey] ?? clips.walk;
      npc.idleClip = clips[npc.idleClip.name as AnimationClipKey] ?? clips.idle;
      for (const [oldClip, clip] of pairedClips) {
        const oldAct = npc.mixer.existingAction(oldClip);
        if (!oldAct?.isRunning()) continue;
        const act = npc.mixer.clipAction(clip);
        crossFadeSynchronized(oldAct, act);
        // npc.mixer.uncacheAction(oldAct.getClip());
      }
    }
    Object.assign(state.clips, clips);

    state.skin = { entries: queryData.skinEntries, manifest: queryData.skinManifest };
    w.setNextPending({ skins: false });
  }, [queryData]);

  useEffect(() => void (import.meta.env.DEV && state.devHotReload()), []);

  return state.gltf && Object.values(state.npc).map((npc) => <MemoNpcInstance key={npc.key} npc={npc} />);
}

export type AnimationClipKey = keyof typeof fromAnimationClipKey;

export type State = {
  clips: Record<AnimationClipKey, THREE.AnimationClip>;
  crowd: crowdApi.Crowd;
  gltf: GLTF | null;
  skin: {
    manifest: AssetsSkinManifestType;
    entries: SkinSheetEntry[];
  };
  lastHmr: number;

  byPickId: Record<number, Npc>;
  nextPickId: number;
  npc: Record<string, Npc>;
  physics: { positions: number[] } & PhysicsBijection;

  configureCrowd(): void;
  createMaterials(
    pickId: number,
    skinIndex: number,
  ): {
    skinIndexUniform: ReturnType<typeof uniform<"float", number>>;
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
  placeNpcAt(npc: Npc, at: JshCli.PointAnyFormat, type: "navigable" | "doable"): void;
  devHotReload(): void;
  /**
   * - Instantiated decor point with meta.do has groundPoint, orient, y.
   * - It is enriched with `decor.key` in <Decor>.
   * - Returns `null` if `meta` is not doable.
   * - Throws if `meta` is doable but not free.
   */
  findFreeDoMeta(
    meta: Meta,
    npcKey: string,
  ): null | Meta<{ key: string; groundPoint: Geom.VectJson; y?: number; orient?: number }>;
  getClosestPoly(targetPos: JshCli.PointAnyFormat, queryFilter?: QueryFilter): FindNearestPolyResult;
  get(npcKey: string): Npc;
  getSkinIndex(skinKey: string): number;
  move(opts: JshCli.MoveOpts): Promise<void>;
  onTick(delta: number): void;
  remove(...npcKeys: string[]): void;
  spawn(opts: JshCli.SpawnOpts): Promise<void>;
};

function getAgentParams(): crowd.AgentParams {
  return {
    radius: 0.2,
    height: 1.2,
    maxAcceleration: walkMaxAcceleration,
    maxSpeed: idleAgentMaxSpeed,
    // collisionQueryRange: 1,
    // collisionQueryRange: 0.75,
    // cannot be smaller; maybe should be larger
    collisionQueryRange: 0.5,
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

function metaToIdleAnimationClipKey(meta: Meta): AnimationClipKey {
  if (meta.do === "sit" || meta.do === "lie" || meta.do === "stand") return meta.do;
  return defaultIdleAnimationClipKey;
}

const npcKeyPattern = /^[a-z][a-z0-9-]*$/;
const closePolygonDistance = 0.005;
const closePolygonHalfExtents: Vec3 = [closePolygonDistance, closePolygonDistance, closePolygonDistance];

import.meta.hot?.on("vite:beforeUpdate", (payload) => {
  const updatedThisFile = payload.updates.some((update) => update.path.endsWith("NPCs.tsx"));
  if (import.meta.hot && updatedThisFile) {
    // used to ignore stale queryFn and trigger fresh one
    import.meta.hot.data.__JUST_HMR_NPCS__ = true;
  }
});
