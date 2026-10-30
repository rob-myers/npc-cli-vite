import { url } from "@npc-cli/media";
import { useStateRef } from "@npc-cli/util";
import { devCacheBust, getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { geomService } from "@npc-cli/util/geom-service";
import { hashJson, keys, mapValues } from "@npc-cli/util/legacy/generic";
import { buildGraph, useStore as useReactThreeFiberStore } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import { deltaAngle } from "maath/misc";
import {
  ANY_QUERY_FILTER,
  createFindNearestPolyResult,
  type FindNearestPolyResult,
  findNearestPoly,
  type NodeRef,
  type QueryFilter,
} from "navcat";
import { type crowd, crowd as crowdApi } from "navcat/blocks";
import { useContext, useEffect, useMemo } from "react";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// deep import: the `Addons.js` barrel drags all 268 example modules into the bundle
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { uniform } from "three/tsl";
import * as THREE from "three/webgpu";
import { AssetsSkinManifestSchema, type AssetsSkinManifestType, type SkinSheetEntry } from "../assets.schema";
import { npcDims, skinSliceDims } from "../const.both";

import {
  agentConfig,
  type BreathTune,
  closestPolyByAccuracy,
  crowdConfig,
  defaultBreathTune,
  defaultIdleAnimationClipKey,
  fromAnimationClipKey,
  npcConfig,
  npcMaterialConfig,
  npcScale,
  npcSpawnConfig,
} from "../const.npc";
import {
  addBodyPartAttr,
  addEmptyBillboardOffset,
  createSkinnedLabelQuad,
  mergeWithGroupAttr,
} from "../service/geometry";
import { helper } from "../service/helper";
import { createNpcMaterial, type NpcMaterial } from "../service/npc-material";
import { npcToBodyKey } from "../service/physics-bijection";
import { npcJointToPickGreen } from "../service/pick";
import { loadSkinSheets, loadSkinSliceSheets } from "../service/skin-sheets";
import { getWorldStore } from "../service/storage";
import type { PhysicsBijection } from "../worker/physics.store";
import { MemoNpcInstance } from "./NpcInstance";
import { Npc, type NpcInit } from "./npc";
import { emptyAnimationClip, NpcAnimation } from "./npc-animation";
import { WorldContext } from "./world-context";

export default function NPCs() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      clips: mapValues(fromAnimationClipKey, () => emptyAnimationClip),
      headYByPose: mapValues(fromAnimationClipKey, () => 0),
      crowd: crowdApi.create(npcDims.maxAgentRadius),
      defaultSkinKey: "medic-0",
      breathTune: { ...defaultBreathTune, ...getWorldStore(w.key).read().breathTune },
      // ONE uniform every npc material reads, so the slider is a value write rather than a rebuild
      dimNode: uniform(w.npcBrightness),
      ambientNode: uniform(w.getTheme().npcs.ambient),
      gltf: null,
      gltfHash: 0,
      restored: false,
      skin: {
        manifest: { byKey: {} } as AssetsSkinManifestType,
        entries: [] as SkinSheetEntry[],
      },

      byAgentId: {},
      byPickId: {},
      config: npcConfig,
      doableToNpc: {},
      nextPickId: 0,
      npc: {},
      npcToDoable: {},
      npcToRoom: new Map(),
      physics: { positions: [], bodyKeyToUid: {}, bodyUidToKey: {} },
      postCrowdTickEvents: [],
      roomToNpcs: [],
      tickResolvers: [],

      clearMomentum(npc) {
        if (npc.agentId === null) {
          return;
        }
        const result = state.getClosestPoly(npc.point, 0.5);
        if (result.success === true) {
          // a fresh agent at the same spot has no velocity, so nothing carries over
          state.placeNpcAt(npc, result, npc.point);
        }
      },
      compactPickIds() {
        state.byPickId = {};
        state.nextPickId = 0;
        for (const npc of Object.values(state.npc)) {
          const pickId = state.nextPickId++;
          state.byPickId[pickId] = npc;
          if (npc.pickId === pickId) continue;
          npc.pickIdUniform.value = pickId; // `pickId` and `labelLayerIndex` both read off it
          npc.drawLabel(); // into its new layer
        }
      },
      configureCrowd() {
        // improve initial path accuracy
        state.crowd.quickSearchIterations = crowdConfig.quickSearchIterations;
      },
      createMaterials(pickId, skinIndex) {
        return createNpcMaterial(w, { pickId, skinIndex, ambient: state.ambientNode, dim: state.dimNode });
      },
      buildNpcMesh() {
        // the clone brings its own skeleton; the label rides in the geometry
        const clone = SkeletonUtils.clone((state.gltf as GLTF).scene);
        const graph = buildGraph(clone);
        const skinnedMesh = graph.nodes.root as THREE.SkinnedMesh;
        addEmptyBillboardOffset(skinnedMesh.geometry);
        const geometry = addBodyPartAttr(
          mergeWithGroupAttr(skinnedMesh.geometry, createSkinnedLabelQuad(0, 0)),
          npcJointToPickGreen,
        );
        return { geometry, graph, skinnedMesh };
      },
      createNpc(
        opts: Pick<NpcInit, "key" | "graph" | "geometry" | "position" | "rotation" | "skinnedMesh"> & {
          pickId: number;
          skinIndex: number;
        },
      ) {
        const npc = new Npc(w, {
          key: opts.key,
          graph: opts.graph,
          geometry: opts.geometry,
          position: opts.position,
          rotation: opts.rotation,
          skinnedMesh: opts.skinnedMesh,
          ...state.createMaterials(opts.pickId, opts.skinIndex),
        });

        npc.init();
        npc.drawLabel();

        state.npc[opts.key] = npc;
        state.byPickId[npc.pickId] = npc;
        return npc;
      },
      determineSpawnedAngle(opts) {
        let angle = opts.angle;

        if (typeof opts.meta.orient === "number") {
          angle = -(opts.meta.orient + 90) * (Math.PI / 180);
        } else if (opts.facing) {
          const parsed = helper.parseGroundPoint(opts.facing);
          angle = geomService.getThreeRotationY(parsed.y - opts.groundPoint.y, parsed.x - opts.groundPoint.x);
        } else if (angle !== undefined) {
          // absorb errors else npc disappears
          angle = Number(angle) || 0;
        }

        return typeof angle === "number" ? angle : (opts.npc?.rotation.y ?? 0);
      },
      devHotReload() {
        // every refetch gives a new gltf OBJECT, so compare the file instead
        const hash = state.gltf === null ? 0 : hashJson(state.gltf.parser.json, false);
        const newGltf = hash !== state.gltfHash;
        state.gltfHash = hash;
        // a field added since: `tickBreath` reads it as it is, with no defaults under it
        state.breathTune = { ...defaultBreathTune, ...state.breathTune };

        /**
         * Don't create but instead mutate existing npcs, thereby avoiding stale references in ongoing code.
         * - we update the prototypes
         * - we update the materials
         * - we update epochMs
         * - BUT currently don't support add/remove/change other properties
         */
        for (const npc of Object.values(state.npc)) {
          Object.setPrototypeOf(npc, Npc.prototype);
          Object.setPrototypeOf(npc.anim, NpcAnimation.prototype);
          // fields added since, and to its plain objects e.g. `upper` — else they read `undefined`
          for (const [key, value] of Object.entries(new NpcAnimation(npc))) {
            const had = (npc.anim as unknown as Record<string, unknown>)[key];
            if (had === undefined) Object.assign(npc.anim, { [key]: value });
            else if (value?.constructor === Object && had?.constructor === Object)
              Object.assign(npc.anim, { [key]: { ...value, ...had } });
          }

          // `NpcInstance` carries their position and rotation over to the new mesh
          if (newGltf === true) Object.assign(npc, state.buildNpcMesh(), { epochMs: Date.now() });

          state.resetMaterials(npc); // can overwrite materials while debugging
          npc.init();
          npc.drawLabel();

          if (npc.agent !== null) {
            const {
              radius,
              height,
              collisionQueryRange,
              boundaryQueryRange,
              obstacleAvoidance,
              pathOptimizationRange,
            } = getAgentParams();
            Object.assign(npc.agent, {
              radius,
              height,
              collisionQueryRange,
              boundaryQueryRange,
              obstacleAvoidance,
              pathOptimizationRange,
            });
          }
        }

        state.update();
      },
      findFreeDoMeta(meta, npcKey, near) {
        const currentDecorKey = state.npcToDoable[npcKey] ?? null;

        if (typeof meta.do === "string") {
          const otherNpcKey = state.doableToNpc[meta.decorKey] ?? null;
          return otherNpcKey !== null && otherNpcKey !== npcKey
            ? { type: "occupied", meta }
            : { type: meta.decorKey === currentDecorKey ? "use-current" : "next-free", meta };
        }

        if (meta.obstacle === true && Array.isArray(meta.decorIds) === true) {
          const gm = w.gms[meta.gmId];
          const ds = (meta.decorIds as number[]).map((decorId) => gm.decor[decorId] as Geomorph.DecorPoint);
          const found = state.findFreeDoPoint(ds, npcKey, near);
          return found === null
            ? { type: "occupied", meta }
            : { type: found.meta.decorKey === currentDecorKey ? "use-current" : "next-free", meta: found.meta };
        }

        return currentDecorKey !== null && meta.npcKey === npcKey && state.npcToDoable[npcKey] !== null
          ? // can respawn onto self whilst doing
            { type: "use-current", meta: w.decor.byKey[currentDecorKey].meta }
          : { type: "none", meta };
      },
      findFreeDoPoint(points, npcKey, near) {
        const free = points.filter((d) => {
          const otherNpcKey = state.doableToNpc[d.key] ?? null;
          return otherNpcKey === null || otherNpcKey === npcKey;
        });
        if (near === undefined) return free.find((d) => d.key === state.npcToDoable[npcKey]) ?? free[0] ?? null;
        const distSq = (d: Geomorph.DecorPoint) => (d.x - near.x) ** 2 + (d.y - near.y) ** 2;
        return free.reduce<null | Geomorph.DecorPoint>(
          (best, d) => (best === null || distSq(d) < distSq(best) ? d : best),
          null,
        );
      },
      hit(npcKey, part) {
        const npc = state.npc[npcKey];
        const clip = npc?.anim.hitClipFor(part) ?? null;
        if (npc === undefined || part === null || clip === null) return;
        npc.rejectAll(new Error("hit")); // a move's own catch idles them, onto the clip
        npc.anim.setHurt(clip);
        w.events.next({ key: "npc-hit", npcKey, part, clip });
      },
      get(npcKey) {
        const npc = state.npc[npcKey];
        if (npc === undefined) {
          throw Error(`npc "${npcKey}" does not exist`);
        }
        return npc;
      },
      getNodeRef(agent) {
        return agent.corridor.path[0];
      },
      getClosestPoly(targetPos, accuracy = 0.005, queryFilter = ANY_QUERY_FILTER) {
        const targetTuple = helper.groundPointToTuple(helper.parseGroundPoint(targetPos));
        const { halfExtents, distance } = closestPolyByAccuracy[accuracy];
        const result = findNearestPoly(
          createFindNearestPolyResult(),
          w.nav.navMesh,
          targetTuple,
          halfExtents,
          queryFilter,
        );
        if (result.success === true) {
          // 🔔 force fail when XZ distance exceeds half extent
          const dist = Math.hypot(result.position[0] - targetTuple[0], result.position[2] - targetTuple[2]);
          result.success = dist <= distance;
        }
        return result;
      },
      findSkinKey(prefix = state.defaultSkinKey) {
        const keys = state.skin.entries.map((entry) => entry.key);
        // an exact key first, else `medic-1` could give `medic-10`
        return keys.find((key) => key === prefix) ?? keys.find((key) => key.startsWith(prefix)) ?? state.defaultSkinKey;
      },
      setBreathTune(partial) {
        Object.assign(state.breathTune, partial);
        getWorldStore(w.key).patch({ breathTune: { ...state.breathTune } });
      },
      getSkinIndexBySkinKey(skinKey) {
        return state.skin.entries.findIndex((entry) => entry.key === skinKey);
      },
      getSkinKeyBySkinIndex(skinIndex) {
        return state.skin.entries[skinIndex]?.key ?? null;
      },
      getSkinMeta(skinKey: string) {
        return state.skin.manifest.byKey[skinKey]?.meta ?? {};
      },
      hasDoMeta(meta) {
        return typeof meta.do === "string" || (meta.obstacle === true && Array.isArray(meta.decorIds));
      },
      nextTick() {
        return new Promise<void>((resolve) => state.tickResolvers.push(resolve));
      },
      onTick(delta) {
        if (w.client === false) crowdApi.update(state.crowd, w.nav.navMesh, delta);
        const { positions } = state.physics;
        const worldSeconds = w.gameTime.now();

        for (const npc of Object.values(state.npc)) {
          npc.anim.tick(delta);

          if (npc.agentId === null) {
            continue;
          }

          const agent = state.crowd.agents[npc.agentId];
          // ignore obstacles when nearly arrived to avoid slow-down near nav-edges
          const arriving = crowdApi.isAgentAtTarget(state.crowd, npc.agentId, agent.radius * 2);
          agent.updateFlags = arriving === true ? arrivingUpdateFlags : movingUpdateFlags;

          npc.position.x = agent.position[0];
          npc.position.z = agent.position[2];
          const [vx, , vz] = agent.velocity;
          const speed = Math.hypot(vx, vz);
          npc.anim.speed = speed; // paces the gait — after arriving too, whilst it fades out

          if (npc.isLooking() === true) {
            continue;
          }

          if (!npc.isMoving()) {
            if (speed < 0.05) {
              // cannot immediately else walk -> idle slides
              agent.maxAcceleration = agentConfig.maxAcceleration.idleSeparating;
            }
            continue;
          }

          // their facing, for the next tick: turning as fast as they walk, and not at all when
          // creeping — a stuck npc's velocity swings about, and turning to face each swing looks
          // like a jerk
          npc.anim.face.rate =
            speed > 0.05 && npc.anim.strafe !== true ? Math.min(1, speed / agentConfig.maxSpeed.walk) : 0; // strafing holds it
          // backing away they face whence they go
          if (speed > 0.05) npc.anim.face.target = Math.atan2(vx, vz) + (npc.anim.backwards === true ? 0 : Math.PI);

          const [tx, , tz] = agent.targetPosition;
          const targetDist = Math.hypot(tx - npc.position.x, tz - npc.position.z);
          const stuck = updateStuck(npc, delta, worldSeconds, targetDist);

          if (npc.anim.fast === true) {
            // to arrive they walk in — see `walkIn`; gliding through, they keep running
            const { maxSpeed, walkIn } = agentConfig;
            const t = npc.anim.arrive === true ? (targetDist - walkIn.to) / (walkIn.from - walkIn.to) : 1;
            agent.maxSpeed = maxSpeed.walk + (maxSpeed.run - maxSpeed.walk) * Math.max(0, Math.min(1, t));
          }

          // circling is stuck when another npc stands on the target — see `docs/npc-debug-notes.md`
          if (stuck === "still" || (stuck === "circling" && isTargetOccupied(agent, state.crowd))) {
            npc.rejectAll(new Error("stuck"));
          } else if (
            moveClipFadedIn(npc) === true &&
            (crowdApi.isAgentAtTarget(state.crowd, npc.agentId, getArriveDistance(npc)) === true ||
              // ...or settled close by: past the grace, else a short move starts arrived
              (arriving === true &&
                speed < agentConfig.settleSpeed &&
                worldSeconds - npc.last.moveTime > npcConfig.time.stuckGrace))
          ) {
            // arrived
            npc.anim.startIdle();
            state.postCrowdTickEvents.push({ key: "stopped-moving", npcKey: npc.key });
          }

          const { x, y, z } = npc.position;
          positions.push(npc.bodyUid, x, y, z);
        }

        if (positions.length > 0) {
          // Float32Array caused issues: decode failed
          const positions64 = new Float64Array(positions);
          w.physics.worker.postMessage({ type: "send-npc-positions", positions: positions64 }, [positions64.buffer]);
          positions.length = 0;
        }

        for (const event of state.postCrowdTickEvents) w.events.next(event);
        state.postCrowdTickEvents.length = 0;
        for (const resolve of state.tickResolvers) resolve();
        state.tickResolvers.length = 0;
      },
      placeNpcAt(npc, closePolyResult, override) {
        const groundPoint = helper.parseGroundPoint(override ?? closePolyResult.position);

        if (w.client === true) {
          // mirror npcs get no crowd agent or physics body — the server world drives them
          state.removeAgents([npc], { keepPhysics: true });
          npc.position.x = groundPoint.x;
          npc.position.z = groundPoint.y;
          return;
        }

        if (!closePolyResult.success) {
          // do not throw in case of hot reload with changing geometry
          state.removeAgents([npc]);
          npc.position.x = groundPoint.x;
          npc.position.z = groundPoint.y;
          return;
        }

        if (npc.agentId !== null) {
          // - must remove agent so can teleport without issues
          // - re-adding changes the npc.agentId ATOW
          state.removeAgents([npc], { keepPhysics: true });
        } else {
          w.physics.worker.postMessage({
            type: "add-physics-npcs",
            npcs: [{ npcKey: npc.key, position: helper.groundPointToVector3(groundPoint) }],
          } satisfies WW.MsgToWorker);
        }

        npc.agentId = crowdApi.addAgent(
          state.crowd,
          w.nav.navMesh,
          helper.groundPointToTuple(groundPoint),
          getAgentParams(),
        );
        state.byAgentId[npc.agentId] = npc;

        npc.pinTo(closePolyResult, groundPoint);

        // might have spawned into a sensor
        state.physics.positions.push(npc.bodyUid, ...helper.groundPointToTuple(groundPoint));
        // } else if (type === "navigable") {
        //   throw Error("not placable");
      },
      removeAgents(npcs, { keepPhysics = false } = {}) {
        for (const npc of npcs) {
          if (npc.agentId === null) continue;
          crowdApi.removeAgent(state.crowd, npc.agentId);
          delete state.byAgentId[npc.agentId];
          npc.agentId = null;
        }

        if (keepPhysics === true) return;

        // physics worker will fire exit colliders
        w.physics.worker.postMessage({
          type: "remove-physics-bodies",
          bodyKeys: npcs.map((npc) => npcToBodyKey(npc.key)),
        } satisfies WW.MsgToWorker);
      },
      rawSpawn(opts) {
        let npc = w.n[opts.npcKey];

        const closePolyResult = opts.closePolyResult ?? state.getClosestPoly(opts.groundPoint);
        const positionY = opts.doResult?.meta.y ?? 0;
        const rotationY = state.determineSpawnedAngle({
          groundPoint: opts.groundPoint,
          meta: opts.doResult.meta ?? emptyMeta,
          angle: opts.angle,
          facing: opts.facing,
          npc,
        });

        if (!npc) {
          const { compactPickIdsAt } = npcSpawnConfig;
          if (state.nextPickId > compactPickIdsAt && Object.keys(state.npc).length < compactPickIdsAt) {
            state.compactPickIds();
          }

          const { geometry, graph, skinnedMesh } = state.buildNpcMesh();
          skinnedMesh.rotation.y = rotationY;

          npc = state.createNpc({
            key: opts.npcKey,
            geometry,
            graph,
            pickId: state.nextPickId++,
            position: helper.groundPointToVector3(opts.groundPoint).setY(positionY),
            rotation: skinnedMesh.rotation,
            skinnedMesh,
            skinIndex: state.getSkinIndexBySkinKey(opts.as ?? state.defaultSkinKey),
          });
        }

        if (typeof opts.doResult?.meta.decorKey === "string") {
          const overrideGroundPoint = opts.doResult.meta.groundPoint;
          state.placeNpcAt(npc, closePolyResult, overrideGroundPoint);
          npc.anim.idleClip = state.clips[metaToIdleAnimationClipKey(opts.doResult.meta)];
          state.setNpcDo(opts.npcKey, opts.doResult.meta.decorKey);
        } else {
          const overrideGroundPoint =
            opts.groundPoint.meta?.npcKey === opts.npcKey ? helper.parseGroundPoint(npc.position) : undefined;
          state.placeNpcAt(npc, closePolyResult, overrideGroundPoint);
          npc.anim.idleClip = state.clips[defaultIdleAnimationClipKey];
          state.setNpcDo(opts.npcKey, null);
        }

        // for respawn
        npc.position.setY(positionY);
        npc.rotation.y = rotationY;
        npc.anim.face.rate = 0;
        // a spawn is a rest: else a look made on the move turns them where they land e.g. in bed
        if (npc.anim.face.aim?.untilRest === true) npc.anim.face.aim = null;

        return npc;
      },
      liftBunkLabels() {
        const lies = Object.values(w.decor.byKey).filter(
          (d): d is Geomorph.DecorPoint => d.type === "point" && d.meta.do === "lie",
        );
        const { labelHalfHeight } = npcMaterialConfig;
        const floors = new Map<string, number>();
        for (const npc of Object.values(state.npc)) {
          const decorKey = state.npcToDoable[npc.key];
          const at = typeof decorKey === "string" ? w.decor.byKey[decorKey] : undefined;
          // the lie point straight above theirs, i.e. a top bunk
          const above =
            at?.type === "point" && at.meta.do === "lie"
              ? lies
                  .filter((d) => d.meta.y > at.meta.y && Math.hypot(d.x - at.x, d.y - at.y) < sameBunkMetres)
                  .sort((a, b) => a.meta.y - b.meta.y)[0]
              : undefined;
          if (above === undefined) continue;
          // theirs just above the bunk, and its occupant's above that: the labels in the order of the bunks
          const floor = above.meta.y + bunkLabelClearMetres;
          floors.set(npc.key, floor);
          const occupant = state.doableToNpc[above.key] ?? null;
          if (occupant !== null) floors.set(occupant, floor + 2 * labelHalfHeight + labelGapMetres);
        }
        for (const npc of Object.values(state.npc)) npc.setLabelFloor?.(floors.get(npc.key) ?? null);
      },
      setNpcDo(npcKey, decorKey) {
        const currentDecorKey = state.npcToDoable[npcKey];
        if (typeof currentDecorKey === "string") {
          state.doableToNpc[currentDecorKey] = null;
        }
        if (typeof decorKey === "string") {
          state.doableToNpc[decorKey] = npcKey;
        }
        state.npcToDoable[npcKey] = decorKey;
        w.events.next({ key: "npc-do", npcKey, decorKey });
        // only a bed, left or taken, can change whose label clears a bunk
        const isBed = (key: unknown) => typeof key === "string" && w.decor.byKey[key]?.meta.do === "lie";
        if (isBed(currentDecorKey) || isBed(decorKey)) state.liftBunkLabels();
      },
      resetMaterials(npc) {
        const mat = state.createMaterials(npc.pickId, npc.skinIndex);
        mat.npcLit.value = npc.lit === true ? 1 : 0;
        mat.dotScreen.value = npc.dotScreen?.value ?? 0; // undefined on an npc from before hmr
        mat.roomSlot.value = npc.roomSlot.value; // fresh uniforms, but they stand where they did
        mat.labelYShiftUniform.value = npc.labelYShiftUniform.value; // ...and their label sits where it did
        mat.labelRectUniform.value.copy(npc.labelRectUniform.value);
        mat.eyesUniform.value = npc.eyesUniform.value;
        Object.assign(npc, mat);
        npc.epochMs = Date.now(); // invalidate React.Memo
      },
      async spawn({ npcKey, at, as: skinPrefix, angle, facing }) {
        // NOT resolved when none is given: `findSkinKey` would give the default, and a respawn re-dress them in it
        const as = skinPrefix === undefined ? undefined : state.findSkinKey(skinPrefix);
        if (typeof npcKey !== "string" || !npcSpawnConfig.keyPattern.test(npcKey)) {
          throw Error(`opts.npcKey must match: ${npcSpawnConfig.keyPattern}`);
        }
        if (!at) {
          throw Error("opts.at must exist");
        }

        const groundAt = helper.parseGroundPoint(at);

        // test early to avoid creating unspawnable npc
        // - throw if doable but occupied
        // - throw if not doable and not navigable
        const doResult = state.findFreeDoMeta(at?.meta ?? {}, npcKey, groundAt);
        if (doResult.type === "occupied") {
          throw Error("occupied");
        }

        const gmRoomId = // doable meta is gmRoomId
          doResult.type === "none" ? w.findRoomContaining(at, true) : helper.maybeGmRoomId(doResult.meta);
        if (gmRoomId === null) throw Error("must be in some room");

        const closePolyResult = doResult.type === "none" ? state.getClosestPoly(groundAt, 0.5) : undefined;
        if (closePolyResult?.success === false) {
          throw Error("not placable");
        }

        const prevIdleClip = w.n[npcKey]?.anim.idleClip;
        const playerExisted = w.player.exists();

        const npc = state.rawSpawn({ npcKey, doResult, groundPoint: groundAt, angle, as, closePolyResult, facing });

        w.shadows?.onTick(); // ensure shadow visible even when paused
        w.rings?.onTick();

        if (npc.spawns++ === 0) {
          await new Promise<string>((resolve) => {
            npc.resolve.spawn = resolve; // the mount shows the idle — see `groupRef`
            state.update();
          });
        } else {
          if (as) npc.setSkin(as);
          if (prevIdleClip !== npc.anim.idleClip)
            npc.anim.setPose(npc.anim.idleClip.name as AnimationClipKey, { fade: 0 });
          w.view.forceUpdate(0.01);
        }

        if (!playerExisted && w.client === false) {
          w.player.assign(npcKey);
          await w.player.ensure();
        }

        w.events.next({ key: "spawned", npcKey, gmRoomId, spawns: npc.spawns });
      },
      setAmbient(next) {
        state.ambientNode.value = next;
        w.r3f?.invalidate();
      },
      setBrightness(next) {
        state.dimNode.value = next;
        w.r3f?.invalidate(); // a uniform write draws nothing by itself, the frameloop being on demand
      },
      syncOutlineMask() {
        // a material mrt *replaces* the colour output unless the scene pass declares one too, so
        // this must follow `w.view.npcMaskMrt` exactly — see `WorldView.setupPostProcessing`, the
        // only caller. UNCONDITIONALLY, since it is also how a material compiled against the last
        // pipeline's pass is recompiled against this one's, and the node it holds is the same
        // object either way
        for (const npc of Object.values(state.npc)) {
          npc.material.mrtNode = w.view.npcMaskMrt === null ? null : npc.maskMrt;
          npc.material.needsUpdate = true;
        }
      },
      async turnBeforeMoving(npc) {
        if (npc.isMoving() === true || npc.anim.strafe === true) {
          return; // mid-path a turn reads as steering; strafing keeps their facing
        }

        const { agent } = npc;
        if (agent === null || agent.neis.length === 0) {
          return; // only turn if there's an agent nearby
        }

        await state.nextTick(); // the crowd's quick search fills `agent.corners`
        const [corner] = agent.corners;
        if (corner === undefined) return;

        const at = { x: corner.position[0], y: corner.position[2] };
        if (npc.anim.backwards === true) {
          // backs onto it: faces the point opposite
          Object.assign(at, { x: 2 * npc.position.x - at.x, y: 2 * npc.position.z - at.y });
        }
        const target = geomService.getThreeRotationY(at.y - npc.position.z, at.x - npc.position.x);
        if (Math.abs(deltaAngle(npc.rotation.y, target)) > npcConfig.angle.turnBeforeMove) {
          await npc.look({ at });
        }
      },
      warmCrowd() {
        if (w.client === true) return; // clients never path-find
        const rooms = w.gmRoomGraph.nodesArray.filter((node) => node.type === "room");
        if (rooms.length < 2 || Object.keys(state.crowd.agents).length > 0) {
          return;
        }

        const from = state.getClosestPoly(rooms[0].astar.centroid, 0.5);
        const to = state.getClosestPoly(rooms[rooms.length - 1].astar.centroid, 0.5);
        if (from.success === false || to.success === false) {
          return;
        }

        const agentId = crowdApi.addAgent(state.crowd, w.nav.navMesh, from.position, getAgentParams());
        crowdApi.requestMoveTarget(state.crowd, agentId, to.nodeRef, to.position);
        // enough updates to carry the search through its quick pass and into the sliced one, which
        // is where the cost lives
        for (let i = 0; i < crowdConfig.warmTicks; i++) {
          crowdApi.update(state.crowd, w.nav.navMesh, 1 / 60);
        }
        crowdApi.removeAgent(state.crowd, agentId);
      },
    }),
    { reset: { config: true } },
  );

  w.npc = state;
  w.n = state.npc;

  const queryData =
    useQuery({
      // the shareable half — gltf, sheet images, manifest — one query for every world. The
      // per-world half (drawing skins into `w.texSkin`, slices into `w.texSkinSlices`) lives in the memo below.
      // The epoch changes the key on the post-HMR re-render, so the refetch runs the NEW queryFn
      queryKey: ["skins-and-gltf", import.meta.hot?.data.__NPCS_HMR_EPOCH__ ?? 0],
      queryFn: async () => {
        const cacheBust = getDevCacheBustQueryParam();
        const [gltf, skinManifest] = await Promise.all([
          // busted too, so a devtools reset reloads the model — it is self-contained
          new GLTFLoader().loadAsync(devCacheBust(getModelUrl())),
          fetch(`/skin/manifest.json${cacheBust}`).then(async (r) => AssetsSkinManifestSchema.parse(await r.json())),
        ]);
        const sheetImages = await loadSkinSheets(w.sheets, skinManifest, cacheBust);
        const sliceImages = await loadSkinSliceSheets(w.sheets, skinManifest, cacheBust, sheetImages);
        return { gltf, sheetImages, sliceImages, skinManifest };
      },
      enabled: !!w.sheets,
      gcTime: 0,
    }).data ?? null;

  useMemo(() => {
    // draw the skins into THIS world's texture array
    if (!queryData) return;
    const { width: tw, height: th } = w.texSkin.opts;
    const { ct } = w.texSkin;
    ct.imageSmoothingEnabled = false;
    Object.values(w.sheets.skin).forEach(({ sheetId, rect }, i) => {
      ct.clearRect(0, 0, tw, th);
      ct.drawImage(queryData.sheetImages[sheetId], rect.x, rect.y, rect.width, rect.height, 0, 0, tw, th);
      w.texSkin.updateIndex(i);
    });

    // ...and each skin's slices into its layer of the slices' — see `docs/skin-slices.md`
    const { cell, maxSkins } = skinSliceDims;
    const sliceCt = w.texSkinSlices.ct;
    sliceCt.imageSmoothingEnabled = false;
    Object.values(w.sheets.skin).forEach(({ key }, i) => {
      if (i >= maxSkins) return console.warn(`${key}: no slices, beyond ${maxSkins} skins`);
      const entry = w.sheets.skinSlices[key];
      sliceCt.clearRect(0, 0, cell, cell);
      if (entry !== undefined) {
        const { x, y, width, height } = entry.rect;
        sliceCt.drawImage(queryData.sliceImages[entry.sheetId], x, y, width, height, 0, 0, cell, cell);
      }
      w.texSkinSlices.updateIndex(i);
    });
  }, [queryData]);

  useMemo(() => {
    state.configureCrowd();

    if (!queryData) return;

    state.gltf = queryData.gltf;

    const anims = queryData.gltf.animations;
    const clips = mapValues(
      fromAnimationClipKey,
      (_, clipName) => anims.find((c) => c.name === clipName) ?? emptyAnimationClip,
    );
    // every clip of the glTF too: one new to it plays after a refetch, before its key reaches this module
    for (const anim of anims) (clips as Record<string, THREE.AnimationClip>)[anim.name] ??= anim;
    const pairedClips = keys(clips).map((clipName) => [state.clips[clipName], clips[clipName]] as const);
    Object.assign(state.clips, clips);
    state.headYByPose = headYByPoseOf(queryData.gltf.scene, clips);

    const staleClips = pairedClips.flatMap(([oldClip, clip]) =>
      oldClip === clip || oldClip === undefined ? [] : [oldClip],
    );
    /** on new clips show the pose afresh: carrying each old action over revives one caught fading out */
    for (const npc of Object.values(state.npc)) {
      npc.anim.moveClip = clips[npc.anim.moveClip.name as AnimationClipKey] ?? clips.walk;
      npc.anim.idleClip = clips[npc.anim.idleClip.name as AnimationClipKey] ?? clips[defaultIdleAnimationClipKey];
      if (staleClips.length === 0 || npc.group === null) continue; // unmounted: the mount shows it
      npc.anim.mixer.stopAllAction();
      for (const oldClip of staleClips) npc.anim.mixer.uncacheClip(oldClip);
      npc.anim.setPose(npc.anim.pose, { fade: 0, force: true });
      // at once: stopping left the bind pose, and no tick comes whilst paused
      npc.anim.mixer.update(0);
      npc.anim.tickUpper(0);
    }

    state.skin = { entries: Object.values(w.sheets.skin), manifest: queryData.skinManifest };
    w.setNextPending({ gltf: false, skins: false });
  }, [queryData]);

  w.r3fStore = useReactThreeFiberStore();

  useEffect(
    () => void (import.meta.env.DEV && state.devHotReload()),
    // `const.npc`'s hmr gives a NEW object: without it the materials keep their baked numbers
    [queryData?.gltf, w.view.playerLight.uid, w.view.fadeRoomsFx.uid, npcMaterialConfig],
  );

  return (
    state.gltf &&
    Object.values(state.npc).map((npc) => <MemoNpcInstance key={npc.key} npc={npc} epochMs={npc.epochMs} />)
  );
}

export type AnimationClipKey = keyof typeof fromAnimationClipKey;

export type State = {
  clips: Record<AnimationClipKey, THREE.AnimationClip>;
  /** Metres of the head bone's pivot above an npc's feet, per pose at its start — see `Psi` */
  headYByPose: Record<AnimationClipKey, number>;
  crowd: crowdApi.Crowd;
  /** The skin an npc wears unless given another */
  readonly defaultSkinKey: string;
  /** How the player breathes, persisted — see `BreathControls` */
  breathTune: BreathTune;
  /** How much of their skin every npc keeps — see `setBrightness`, and `w.npcBrightness` behind it */
  dimNode: THREE.UniformNode<"float", number>;
  /** The least exposure an npc has, from `theme.npcs.ambient` — a light theme has no dark to stand in */
  ambientNode: THREE.UniformNode<"float", number>;
  gltf: GLTF | null;
  /** DEV: hash of the gltf the npc meshes were built from — see `devHotReload` */
  gltfHash: number;
  /** Whether this map's saved npcs are back. Until then a save would overwrite them with fewer — see `persistNpcs` */
  restored: boolean;
  skin: {
    manifest: AssetsSkinManifestType;
    entries: SkinSheetEntry[];
  };

  byAgentId: Record<string, Npc>;
  byPickId: Record<number, Npc>;
  /** `const.npc`'s tuning, for World hooks, which must not import it */
  config: typeof npcConfig;
  doableToNpc: { [decorKey: string]: string | null };
  nextPickId: number;
  npc: Record<string, Npc>;
  npcToDoable: { [npcKey: string]: string | null };
  /**
   * Relates `npcKey` to current room.
   */
  npcToRoom: Map<string, Geomorph.GmRoomId>;
  physics: { positions: number[] } & PhysicsBijection;
  postCrowdTickEvents: JshCli.Event[];
  /**
   * The "inverse" of npcToRoom i.e. `roomToNpc[gmId][roomId]` is a set of `npcKey`s
   */
  roomToNpcs: { [roomId: number]: Set<string> }[];
  tickResolvers: (() => void)[];

  /** A fresh mesh cloned from `gltf`, with its own skeleton and the label quad merged in */
  buildNpcMesh(): Pick<NpcInit, "geometry" | "graph" | "skinnedMesh">;
  /** Leaves `npc` exactly where it is, at rest — a moving agent would otherwise slide on */
  clearMomentum(npc: Npc): void;
  configureCrowd(): void;
  /** Sets `ambientNode`'s value — called by `onChangeTheme` */
  setAmbient(next: number): void;
  /** Sets `dimNode`'s value — called by `WorldMenu`'s slider, never `.value` directly */
  setBrightness(next: number): void;
  /** Keeps every npc's `mrtNode` in step with `w.view.npcMaskMrt` */
  syncOutlineMask(): void;
  /** Their material and uniforms — see `service/npc-material` */
  createMaterials(pickId: number, skinIndex: number): NpcMaterial;
  /**
   * Renumbers every npc's `pickId` from `0`, closing the gaps removals leave — so `nextPickId`,
   * and the label texture array it indexes, stay small
   */
  compactPickIds(): void;
  /** Fresh materials for `npc`, carrying over the uniforms that hold live state. Bumps `epochMs` */
  setNpcDo(npcKey: string, decorKey: string | null): void;
  /** Lifts the label of each npc lain beneath a top bunk clear of it, and that of whoever lies on it above theirs */
  liftBunkLabels(): void;
  resetMaterials(npc: Npc): void;
  determineSpawnedAngle(opts: {
    /** Spawn destination */
    groundPoint: JshCli.GroundPoint;
    /** Meta of spawn destination */
    meta: Meta<Record<string, any>>;
    /** Desired angle, if any */
    angle?: number;
    /** Target to look at, if any */
    facing?: JshCli.PointAnyFormat;
    /** Non-existent on 1st spawn */
    npc?: Npc;
  }): number;
  createNpc(opts: {
    key: string;
    geometry: THREE.BufferGeometry;
    graph: ReturnType<typeof buildGraph>;
    pickId: number;
    position: THREE.Vector3;
    rotation: THREE.Euler;
    skinnedMesh: THREE.SkinnedMesh;
    skinIndex: number;
  }): Npc;
  /**
   * We override when:
   * - placing npc off-mesh at decor point
   * - when respawning into self
   */
  placeNpcAt(npc: Npc, closePolyResult: FindNearestPolyResult, override?: JshCli.GroundPoint): void;
  devHotReload(): void;
  /**
   * - Instantiated decor point with meta.do has groundPoint, orient, y.
   * - It is enriched with `decorKey` in <Decor>.
   * - Returns `null` if `meta` is not doable.
   * - Throws if `meta` is doable but not free.
   */
  findFreeDoMeta(meta: Meta, npcKey: string, near?: Geom.VectJson): JshCli.FindDoMetaResult;
  /** Of `points`, the free one nearest `near`, e.g. the point picked, theirs included: without it, theirs, else the first free */
  findFreeDoPoint(points: Geomorph.DecorPoint[], npcKey: string, near?: Geom.VectJson): null | Geomorph.DecorPoint;
  /** The navmesh poly under an agent, which the crowd keeps under their feet */
  getNodeRef(agent: crowd.Agent): NodeRef;
  getClosestPoly(
    targetPos: JshCli.PointAnyFormat,
    accuracy?: 0.005 | 0.1 | 0.5 | 4,
    queryFilter?: QueryFilter,
  ): FindNearestPolyResult;
  get(npcKey: string): Npc;
  /** A phaser's beam reached `part` of them: stops them, and plays its clip if it has one */
  hit(npcKey: string, part: null | string): void;
  /** The skin of that key, else the first whose key begins with it, else `defaultSkinKey` */
  findSkinKey(prefix?: string): string;
  getSkinIndexBySkinKey(skinKey: string): number;
  getSkinKeyBySkinIndex(skinIndex: number): string | null;
  getSkinMeta(skinKey: string): Meta;
  hasDoMeta(meta: Meta): boolean;
  /** Resolves at the end of the next tick, i.e. once the crowd has been updated */
  nextTick(): Promise<void>;
  onTick(delta: number): void;
  removeAgents(npcs: Npc[], opts?: { keepPhysics?: boolean }): void;
  rawSpawn(opts: {
    npcKey: string;
    groundPoint: Meta<JshCli.GroundPoint>;
    doResult: JshCli.FindDoMetaResult;
    angle?: number;
    /** Skin to use */
    as?: string;
    /** Defaults to `state.getClosestPoly(groundAt)` */
    closePolyResult?: FindNearestPolyResult;
    /**
     * Position to look towards
     * - overrides `angle`
     * - overriden by `meta.orient`
     */
    facing?: JshCli.PointAnyFormat;
  }): Npc;
  setBreathTune(partial: Partial<BreathTune>): void;
  spawn(opts: JshCli.SpawnOpts): Promise<void>;
  /**
   * Shuffle round before walking off, when the first leg is well behind them AND someone stands
   * near: avoidance can hold a walker near-still beside an idle npc, and facing follows velocity
   * (see `onTick`), so the opening turn would otherwise be spent spinning on the spot
   */
  turnBeforeMoving(npc: Npc): Promise<void>;
  /** Walks a throwaway agent whilst the map loads, so nobody pays for a cold search — see within */
  warmCrowd(): void;
};

/** Capped by the initial distance, so a short move need not start arrived */
function getArriveDistance(npc: Npc) {
  const { arrive, glide, arriveMin, arriveFraction } = npcConfig.dist;
  const base = npc.anim.arrive ? arrive : glide[npc.running ? "run" : "walk"];
  return Math.min(base, Math.max(arriveMin, arriveFraction * npc.last.targetDistance));
}

/**
 * `"still"` once barely moving for `stuckDuration`; `"circling"` once close to the target yet no
 * nearer for as long — given once per such spell, so the caller tests why only then
 */
function updateStuck(npc: Npc, delta: number, worldSeconds: number, targetDist: number): false | "still" | "circling" {
  const { position, last } = npc;
  const { stuckEpsilon, circling } = npcConfig.dist;
  const { stuckGrace, stuckDuration } = npcConfig.time;

  // grace whilst accelerating away from standstill
  if (worldSeconds - last.moveTime < stuckGrace) {
    return false;
  }

  const dist = Math.hypot(position.x - last.point.x, position.z - last.point.y);
  last.stuckAccum += dist < stuckEpsilon ? delta : 0;
  last.point.x = position.x;
  last.point.y = position.z;
  if (last.stuckAccum > stuckDuration) return "still";

  if (targetDist <= circling) {
    if (last.nearest - targetDist > stuckEpsilon) {
      last.nearest = targetDist;
      last.nearestAccum = 0;
    } else if ((last.nearestAccum += delta) > stuckDuration) {
      last.nearestAccum = 0;
      return "circling";
    }
  }

  return false;
}

/** Pose a spare copy in each clip at its start, and read the head bone's height — once per model */
/** The glb in production. DEV loads the gltf, or the glb given `?glb` in the page's url */
function getModelUrl() {
  const glb = !import.meta.env.DEV || new URLSearchParams(location.search).has("glb");
  return glb ? url.currentGlb : url.currentGltf;
}

function headYByPoseOf(scene: THREE.Object3D, clips: Record<AnimationClipKey, THREE.AnimationClip>) {
  const model = SkeletonUtils.clone(scene);
  const head = model.getObjectByName("head");
  const mixer = new THREE.AnimationMixer(model);
  return mapValues(clips, (clip) => {
    mixer.stopAllAction(); // the rest pose, bar what this clip moves
    mixer.clipAction(clip).play();
    mixer.update(0);
    return (head?.getWorldPosition(tmpVector3).y ?? 0) * npcScale;
  });
}

const tmpVector3 = new THREE.Vector3();

/**
 * Has the gait finished fading in? Arriving before then would cut it off, looking jerky. Walk and
 * run together, so a crossfade between them near the target does not hold the arrival up
 */
function moveClipFadedIn(npc: Npc) {
  const gaits = ["walk", "run", "backwards", "strafe_left", "strafe_right"] as const;
  return (
    gaits.reduce((sum, key) => sum + (npc.anim.mixer.existingAction(npc.clips[key])?.getEffectiveWeight() ?? 0), 0) >=
    0.99
  );
}

/** Whether another agent stands on `agent`'s target — its neighbours are unsorted, so each is tested */
function isTargetOccupied(agent: crowd.Agent, agents: crowd.Crowd) {
  const [tx, , tz] = agent.targetPosition;
  return agent.neis.some(({ agentId }) => {
    const other = agents.agents[agentId];
    return (
      other !== undefined && Math.hypot(other.position[0] - tx, other.position[2] - tz) < agent.radius + other.radius
    );
  });
}

/**
 * Avoidance is what makes npcs part around each other, and what spoils an arrival.
 * No separation whilst walking: with one neighbour in range it is a fixed 1 m/s shove, on or off at
 * `collisionQueryRange`, blind to walls — at a corner it argues with avoidance, and the walker
 * wavers. Avoidance plans round the neighbour anyway
 */
const movingUpdateFlags =
  crowdApi.CrowdUpdateFlags.ANTICIPATE_TURNS |
  crowdApi.CrowdUpdateFlags.OBSTACLE_AVOIDANCE |
  crowdApi.CrowdUpdateFlags.OPTIMIZE_VIS;

const arrivingUpdateFlags = crowdApi.CrowdUpdateFlags.ANTICIPATE_TURNS | crowdApi.CrowdUpdateFlags.SEPARATION;

function getAgentParams(): crowd.AgentParams {
  return {
    radius: npcDims.agentRadius,
    height: npcDims.height,
    maxAcceleration: agentConfig.maxAcceleration.walk,
    maxSpeed: agentConfig.maxSpeed.idle,
    collisionQueryRange: crowdConfig.collisionQueryRange,
    boundaryQueryRange: crowdConfig.boundaryQueryRange,
    separationWeight: agentConfig.separationWeight.idle,
    updateFlags: movingUpdateFlags,
    obstacleAvoidance: {
      ...crowdApi.DEFAULT_OBSTACLE_AVOIDANCE_PARAMS,
      weightCurVel: crowdConfig.avoidanceWeightCurVel,
    },
    // with OPTIMIZE_VIS fixes occasional corners appearing behind walker moving around idle npc
    pathOptimizationRange: 0.75,
    queryFilter: ANY_QUERY_FILTER,
  };
}

function metaToIdleAnimationClipKey(meta: Meta): AnimationClipKey {
  switch (meta.do) {
    case "sit":
      return "sit";
    case "lie":
      return "lie";
    case "stand":
      return "breathe";
    default:
      return defaultIdleAnimationClipKey;
  }
}

const emptyMeta = {};
/** Lie points nearer than this, one over the other, are bunks */
const sameBunkMetres = 0.05;
/** How far above an empty top bunk the label of whoever lies beneath hangs */
const bunkLabelClearMetres = 0.55;
/** The gap between their label and that of whoever lies on the bunk above, which hangs over theirs */
const labelGapMetres = 0.05;

import.meta.hot?.on("vite:beforeUpdate", (payload) => {
  const updatedThisFile = payload.updates.some((update) => update.path.endsWith("NPCs.tsx"));
  if (import.meta.hot && updatedThisFile) {
    // a fresh epoch changes the query key on the post-HMR re-render, so the refetch runs the
    // NEW queryFn — no stale first invoke to guard against
    import.meta.hot.data.__NPCS_HMR_EPOCH__ = ((import.meta.hot.data.__NPCS_HMR_EPOCH__ ?? 0) as number) + 1;
  }
});
