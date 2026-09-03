import { url } from "@npc-cli/media";
import { useStateRef } from "@npc-cli/util";
import { getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { geomService } from "@npc-cli/util/geom-service";
import { loadImage } from "@npc-cli/util/legacy/dom";
import { keys, mapValues } from "@npc-cli/util/legacy/generic";
import { buildGraph, useStore as useReactThreeFiberStore } from "@react-three/fiber";
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
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// deep import: the `Addons.js` barrel drags all 268 example modules into the bundle
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  float,
  mix,
  modelWorldMatrix,
  mrt,
  normalWorld,
  output,
  positionLocal,
  positionWorld,
  select,
  smoothstep,
  texture as tslTexture,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { AssetsSkinManifestSchema, type AssetsSkinManifestType, type SkinSheetEntry } from "../assets.schema";
import {
  defaultIdleAnimationClipKey,
  fromAnimationClipKey,
  idleAgentMaxSpeed,
  idleSeparatingMaxAcceleration,
  idleSeparationWeight,
  npcConfig,
  walkMaxAcceleration,
} from "../const";
import { addEmptyBillboardOffset, createSkinnedLabelQuad, mergeWithGroupAttr } from "../service/geometry";
import { helper } from "../service/helper";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { alwaysShownSlot } from "../service/room-slots";
import { fetchSkinOverlay, type SelectAnyType } from "../service/texture";
import { crossFadeSynchronized, emptyAnimationClip } from "../service/three-animation";
import type { PhysicsBijection } from "../worker/worker.store";
import { MemoNpcInstance } from "./NpcInstance";
import { Npc, type NpcInit, npcBubbleHeightForClip, npcLabelYShiftForClip } from "./npc";
import { NpcAnimation } from "./npc-animation";
import { WorldContext } from "./world-context";

export default function NPCs() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      clips: mapValues(fromAnimationClipKey, () => emptyAnimationClip),
      crowd: crowdApi.create(npcConfig.dist.maxAgentRadius),
      gltf: null,
      skin: {
        manifest: { byKey: {} } as AssetsSkinManifestType,
        entries: [] as SkinSheetEntry[],
      },
      lastHmr: 0,

      byAgentId: {},
      byPickId: {},
      nextPickId: 0,
      npc: {},
      physics: { positions: [], bodyKeyToUid: {}, bodyUidToKey: {} },
      postCrowdTickEvents: [],

      clearMomentum(npc) {
        if (npc.agentId === null) {
          return;
        }
        const result = state.getClosestPoly(npc.point, "0.5");
        if (result.success === true) {
          // a fresh agent at the same spot has no velocity, so nothing carries over
          state.placeNpcAt(npc, result, npc.point);
        }
      },
      configureCrowd() {
        // improve initial path accuracy
        state.crowd.quickSearchIterations = 64;
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
      createMaterials(pickId: number, skinIndex: number) {
        const skinIndexUniform = uniform(skinIndex);
        // ONE uniform for both uses, so renumbering is a value write rather than a rebuilt material
        const pickIdUniform = uniform(pickId);
        const colorScale = uniform(1);
        const labelVisible = uniform(1, "float");
        const brightness = uniform(1);
        const npcLit = uniform(0);
        const roomSlot = uniform(alwaysShownSlot, "float");

        // - has value 1 iff lit and lighting shown
        // - lit npcs will not be faded with their rooms
        const litAmount = npcLit.mul(w.view.litNpcsEnabled);

        const roomFade = w.view.fadeRoomsFx.getVisiblity(roomSlot);
        const prod = w.view.fadeRoomsFx.prodNode;
        // `prod` fades an npc in two phases: colour drained by the time the sphere starts closing,
        // and symmetrically. `map` only drains the colour, over the whole fade, leaving a black
        // figure we can still watch move about
        const prodTint = roomFade
          .sub(npcFadeShare)
          .div(1 - npcFadeShare)
          .clamp(0, 1);
        const bodyTint = mix(roomFade, prodTint, prod).max(litAmount);
        // switched rather than eased, else leaving `prod` plays the wipe in reverse. Switching in
        // waits for `prod` to arrive, by when the body is black anyway
        const bodyFade = prod
          .greaterThan(0.999)
          .select(roomFade.div(npcFadeShare).clamp(0, 1), float(1))
          .max(litAmount);

        // Per-vertex groupId: 0=body, 1=label
        const groupIdAttr = attribute<"float">("groupId", "float");
        const isLabel = groupIdAttr.greaterThan(0.5);
        const isMain = groupIdAttr.lessThan(0.5);

        // Vertex node: billboard expansion for label, standard skinned MVP otherwise
        const sign = attribute<"vec2">("billboardOffset", "vec2");
        const labelYShift = uniform(0, "float");
        const anchor = vec4(positionLocal.x, positionLocal.y.add(labelYShift), positionLocal.z, 1);
        const viewCtr = cameraViewMatrix.mul(modelWorldMatrix.mul(anchor));
        const labelPos = cameraProjectionMatrix.mul(viewCtr.add(vec4(sign.x.mul(labelHw), sign.y.mul(labelHh), 0, 0)));
        const stdPos = cameraProjectionMatrix.mul(cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(positionLocal, 1))));

        // Color node
        const skinTex = tslTexture(w.texSkin.tex, uv()).depth(skinIndexUniform);

        // An npc keeps its height whilst a map changes over, darkening and fading out together
        // as the world folds around it — see `setWorldFold`
        const fold = w.view.foldNode;

        const toEye = cameraPosition.sub(positionWorld).normalize();
        const facing = normalWorld.dot(toEye).clamp(0, 1);
        const ndotv = facing.mul(brightness).mul(fold);

        // Rim shading where the body turns away from the view: `1 - N·V` is largest exactly along
        // the silhouette. Eased off as the camera climbs overhead, where nearly every surface in
        // sight is a flank turned edge-on and the rim would otherwise take the whole npc rather
        // than outlining them — `toEye.y` is how much of the view is straight down
        const overhead = smoothstep(float(rimOverheadFrom), float(rimOverheadTo), toEye.y);
        const rimBright = mix(float(rimAmount), float(rimOverheadAmount), overhead);
        const rim = facing.oneMinus().pow(rimPower).mul(rimBright).mul(fold);
        // `alphaTestNode` below gives way with this, or the body would be discarded whole the
        // moment its alpha started dropping
        const mainColor = vec4(
          mix(
            vec3(0).mul(positionLocal.y),
            // ADDED rather than multiplied, so it lights the body rather than tinting whatever the
            // skin happened to be — a dark uniform takes a rim as readily as a pale one
            skinTex.rgb.mul(ndotv).add(rimColor.mul(rim)),
            // skinTex.rgb.mul(ndotv),
            colorScale,
          ),
          skinTex.a.mul(fold),
        );

        const labelTex = tslTexture(w.texNpcLabel.tex, uv()).depth(pickIdUniform);
        // a label is unlit, so fading the body would leave it hanging there — it goes first
        const labelColor = vec4(labelTex.rgb, labelTex.a.mul(labelVisible).mul(fold));

        // Output node: encode NPC pick ID for body; suppress label during picking
        const isPickMode = w.view.objectPick.notEqual(0);
        const npcPick = w.view.withPickOutputId(OBJECT_PICK_KEY_TO_RED.npc, pickIdUniform);

        // The silhouette the border is grown from — see `service/npc-outline`. The BODY only: the
        // label is a billboard, and a border around it would read as a box floating overhead.
        // PREMULTIPLIED, against an alpha of `1` — which under the blend is a replace, and the npc
        // must replace rather than accumulate: an arm passing over the torso writes the mask twice,
        // and blending would sum it. `bodyTint` takes the border with it as they black out, and it
        // reaches `0` before the wipe does, so nothing outlines a figure that is no longer there
        const maskAmount = colorScale.mul(fold).mul(bodyTint);
        const maskMrt = mrt({
          npcMask: (select as SelectAnyType)(isMain, vec4(maskAmount, 0, 0, 1), vec4(0, 0, 0, 0)),
        });

        const material = new THREE.MeshStandardNodeMaterial({
          transparent: true,
          depthWrite: true,
          side: THREE.FrontSide, // one draw call
          // - keep these fixed or they'll effect label quad
          // - could add metalness map but we'll handle via SVG edit instead
          metalness: 0,
          roughness: 1,
        });
        // - label/body fade in during unfold
        // - label fades in/out with room, whereas the body is cut away rather than faded
        material.alphaTestNode = (select as SelectAnyType)(
          isLabel,
          float(0.1).mul(fold).mul(roomFade),
          float(0.9).mul(fold),
        );
        material.vertexNode = (select as SelectAnyType)(isLabel, labelPos, stdPos);
        // - playerLight affects body but not label
        // - a LIT npc is never darker than `npcLitUnseen`, and takes the player's light where it
        //   reaches them: the MAX of the two, so being lit is a floor under them rather than a
        //   light of its own that would dim them wherever the player's already fell
        const shaded = w.view.playerLight.applyLightRgba(mainColor);
        const ownLit = vec4(shaded.rgb.max(mainColor.rgb.mul(npcLitUnseen)), mainColor.a);
        // the wipe only — `bodyTint` is applied at the output, see below
        const body = w.view.fadeRoomsFx.applySphereFade(
          mix(shaded, ownLit, litAmount),
          bodyFade,
          npcSphereY,
          npcSphereRadius,
          isMain, // body only
        );
        // a label is a caption rather than a part of them: it fades over the WHOLE of its room's
        // fade, well before and after the body's own share of it, and eased at both ends
        const labelFade = smoothstep(float(0), float(1), roomFade).max(litAmount);
        const label = w.view.fadeRoomsFx.applyFadeRgba(
          w.view.fadeRoomsFx.applyFadeAlpha(labelColor, labelFade),
          labelFade,
        );
        material.colorNode = w.view.fadeRoomsFx.dropPickWhenHidden(
          (select as any)(isLabel, label, body),
          roomFade,
          w.view.objectPick,
        );
        // blacked out at the OUTPUT: `colorNode` is only the albedo, and a standard material still
        // adds specular off the scene lights to an albedo of zero
        const beauty = (select as SelectAnyType)(isMain, vec4(output.rgb.mul(bodyTint), output.a), output);
        material.outputNode = (select as SelectAnyType)(
          isPickMode,
          (select as SelectAnyType)(isMain, npcPick, vec4(0, 0, 0, 0)),
          beauty,
        );
        // attached only whilst the scene pass declares the extra output — see `syncOutlineMask`
        material.mrtNode = w.view.npcMaskMrt === null ? null : maskMrt;

        return {
          brightness,
          colorScale,
          labelVisible,
          labelYShiftUniform: labelYShift,
          maskMrt,
          npcLit,
          pickIdUniform,
          roomSlot,
          skinIndexUniform,
          material,
        };
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
      resetMaterials(npc) {
        const mat = state.createMaterials(npc.pickId, npc.skinIndex);
        mat.npcLit.value = npc.lit === true ? 1 : 0;
        mat.roomSlot.value = npc.roomSlot.value; // fresh uniforms, but they stand where they did
        Object.assign(npc, mat);
        npc.epochMs = Date.now(); // invalidate React.Memo
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

          state.resetMaterials(npc); // can overwrite materials while debugging
          npc.init();
          npc.drawLabel();
        }

        state.update();
      },
      findFreeDoMeta(meta, npcKey) {
        const currentDecorKey = w.e.npcToDoable[npcKey];

        if (typeof meta.do === "string") {
          const otherNpcKey = w.e.doableToNpc[meta.decorKey];
          if (otherNpcKey && otherNpcKey !== npcKey) {
            return { type: "occupied", meta };
          }
          return { type: meta.decorKey === currentDecorKey ? "use-current" : "next-free", meta };
        }

        if (meta.obstacle === true && Array.isArray(meta.decorIds)) {
          const gm = w.gms[meta.gmId];
          const ds = (meta.decorIds as number[]).map((decorId) => gm.decor[decorId] as Geomorph.DecorPoint);
          // 🔔 clarify precedence
          const found = ds.find((d) => !w.e.doableToNpc[d.key] || w.e.doableToNpc[d.key] === npcKey) ?? null;
          if (!found) {
            return { type: "occupied", meta };
          }
          return { type: found.meta.decorKey === currentDecorKey ? "use-current" : "next-free", meta: found.meta };
        }

        if (currentDecorKey && meta.npcKey === npcKey && w.e.npcToDoable[npcKey] !== null) {
          // can respawn onto self whilst doing
          return { type: "use-current", meta: w.decor.byKey[currentDecorKey].meta };
        }

        return { type: "none", meta };
      },
      get(npcKey) {
        const npc = state.npc[npcKey];
        if (npc === undefined) {
          throw Error(`npc "${npcKey}" does not exist`);
        }
        return npc;
      },
      getClosestPoly(targetPos, accuracy = "0.005", queryFilter = ANY_QUERY_FILTER) {
        const targetTuple = helper.groundPointToTuple(helper.parseGroundPoint(targetPos));
        const { halfExtents, distance } = byAccuracy[accuracy];
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
      async move({ npcKey, to, arrive = true, fast }) {
        /** Can be overriden if unreachable due to locked doors */
        let groundPoint = helper.parseGroundPoint(to);

        const npc = state.get(npcKey);
        const result = state.getClosestPoly(groundPoint, "0.5");

        const doResult = state.findFreeDoMeta(to?.meta ?? emptyMeta, npcKey);

        if (doResult.type === "occupied") {
          throw Error("occupied");
        }

        // so can resume doable or nav
        npc.last.dst = helper.parseGroundPoint(to);

        npc.rejectAll(new Error("move again"));

        if (doResult.type !== "none") {
          // doable overrides navigable
          if (doResult.type === "use-current") {
            await state.spawn({ npcKey, at: to }); // respawn
          } else {
            // look when standing nearby
            if (w.e.npcToDoable[npcKey] === null && npc.distanceTo(groundPoint) < npcConfig.dist.doableLook) {
              // else an npc interrupted mid-move keeps its momentum and slides through the look
              state.clearMomentum(npc);
              await npc.look({ at: to, minMs: npcConfig.time.look * 1000 });
            }

            await npc.fadeSpawn({ at: to });
          }
          // fix contiguous move
          npc.anim.moving = false;
          return;
        }

        if (!result.success) {
          throw Error("not navigable");
        }

        if (npc.agentId === null) {
          // fade spawn from doable to nav
          await npc.fadeSpawn({ at: result.position, facingTarget: true });
          return;
        }

        w.e.setNpcDo(npcKey, null); // in case do=stand

        await npc.ensureLegalPosition();

        try {
          // everything interruptible by NEXT move...

          // navigation unreachable relative to locked doors?
          const unreachableResult = await w.e.testTargetUnreachable(npc, w.e.findRoomContaining(groundPoint));
          npc.last.unreachableResult = unreachableResult;

          if (unreachableResult !== null) {
            // destination unreachable
            if (npc.distanceTo(unreachableResult.nearbyPoint) < npcConfig.dist.blockedLook) {
              // too close: look instead of walk
              await npc.look({ at: unreachableResult.nearbyPoint, minMs: npcConfig.time.look * 1000 });
              return;
            }
            // change destination to point near eventual locked door
            const nearDoor = w.npc.getClosestPoly(unreachableResult.nearbyPoint);
            groundPoint = helper.parseGroundPoint(nearDoor.position);
          }

          npc.anim.moveClip = fast ? state.clips.run : state.clips.walk;
          npc.anim.startMoving(groundPoint, result, arrive);

          state.postCrowdTickEvents.push({ key: "started-moving", npcKey });

          await new Promise<string>((resolve, reject) => {
            npc.resolve.move = resolve;
            npc.reject.move = reject;
          });
        } catch (e) {
          if (e instanceof Error && e.message === "move again") {
            return; // interrupting move owns npc now
          }
          npc.anim.startIdle({ force: true });
          throw e;
        }
      },
      onTick(delta) {
        if (w.client === false) crowdApi.update(state.crowd, w.nav.navMesh, delta);
        const { positions } = state.physics;
        const worldSeconds = w.timer.getElapsedTime();

        for (const npc of Object.values(state.npc)) {
          npc.anim.mixer.update(delta);
          npc.anim.fadeTick(delta);
          npc.anim.lookTick(delta);

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

          if (npc.isLooking() === true) {
            continue;
          }

          if (!npc.isMoving()) {
            if (speed < 0.05) {
              // cannot immediately else walk -> idle slides
              agent.maxAcceleration = idleSeparatingMaxAcceleration;
            }
            continue;
          }

          npc.anim.syncAnimation(Math.max(speed, 0.5));

          if (speed > 0.05) {
            npc.anim.rotateTowards(vx, vz, delta);
          }

          const stuck = npc.anim.updateStuck(delta, worldSeconds);

          if (stuck === true) {
            npc.rejectAll(new Error("stuck"));
          } else if (
            npc.anim.moveClipFadedIn() === true &&
            crowdApi.isAgentAtTarget(state.crowd, npc.agentId, getArriveDistance(npc)) === true
          ) {
            // arrived
            npc.anim.startIdle();
          }

          const { x, y, z } = npc.position;
          positions.push(npc.bodyUid, x, y, z);
        }

        // Float32Array caused issues: decode failed
        const positions64 = new Float64Array(positions);
        w.worker.worker.postMessage({ type: "send-npc-positions", positions: positions64 }, [positions64.buffer]);
        positions.length = 0;

        for (const event of state.postCrowdTickEvents) w.events.next(event);
        state.postCrowdTickEvents.length = 0;

        // before the shadows, which read the slot it settles — and every tick, since an npc waiting
        // on a room to arrive takes it the moment it lands rather than at the next door event
        w.e.syncNpcRoomSlots();
        w.shadows?.onTick();
        w.rings?.onTick();
      },
      placeNpcAt(npc, closePolyResult, override) {
        const groundPoint = helper.parseGroundPoint(override ?? closePolyResult.position);

        if (w.client === true) {
          // mirror npcs get no crowd agent or physics body — the server world drives them
          w.e.removeAgents([npc], { keepPhysics: true });
          npc.position.x = groundPoint.x;
          npc.position.z = groundPoint.y;
          return;
        }

        if (!closePolyResult.success) {
          // do not throw in case of hot reload with changing geometry
          w.e.removeAgents([npc]);
          npc.position.x = groundPoint.x;
          npc.position.z = groundPoint.y;
          return;
        }

        if (npc.agentId !== null) {
          // - must remove agent so can teleport without issues
          // - re-adding changes the npc.agentId ATOW
          w.e.removeAgents([npc], { keepPhysics: true });
        } else {
          w.worker.worker.postMessage({
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
          if (state.nextPickId > compactPickIdsAt && Object.keys(state.npc).length < compactPickIdsAt) {
            state.compactPickIds();
          }

          const clone = SkeletonUtils.clone((state.gltf as GLTF).scene);
          const graph = buildGraph(clone);
          const clonedSkinnedMesh = graph.nodes.root as THREE.SkinnedMesh;

          const labelQuad = createSkinnedLabelQuad(0, 0);
          addEmptyBillboardOffset(clonedSkinnedMesh.geometry);
          const geometry = mergeWithGroupAttr(clonedSkinnedMesh.geometry, labelQuad);

          const rotation = clonedSkinnedMesh.rotation;
          rotation.y = rotationY;

          npc = state.createNpc({
            key: opts.npcKey,
            geometry,
            graph,
            pickId: state.nextPickId++,
            position: helper.groundPointToVector3(opts.groundPoint).setY(positionY),
            rotation,
            skinnedMesh: clonedSkinnedMesh,
            skinIndex: state.getSkinIndexBySkinKey(opts.as ?? "medic-0"),
          });
        }

        if (typeof opts.doResult?.meta.decorKey === "string") {
          const overrideGroundPoint = opts.doResult.meta.groundPoint;
          state.placeNpcAt(npc, closePolyResult, overrideGroundPoint);
          npc.anim.idleClip = state.clips[metaToIdleAnimationClipKey(opts.doResult.meta)];
          npc.bubbleOffset.y = npcBubbleHeightForClip(npc.anim.idleClip.name);
          npc.setLabelYShift(npcLabelYShiftForClip(npc.anim.idleClip.name));
          w.e.setNpcDo(opts.npcKey, opts.doResult.meta.decorKey);
        } else {
          const overrideGroundPoint =
            opts.groundPoint.meta?.npcKey === opts.npcKey ? helper.parseGroundPoint(npc.position) : undefined;
          state.placeNpcAt(npc, closePolyResult, overrideGroundPoint);
          npc.anim.idleClip = state.clips[defaultIdleAnimationClipKey];
          npc.bubbleOffset.y = npcBubbleHeightForClip(npc.anim.idleClip.name);
          npc.setLabelYShift(npcLabelYShiftForClip(npc.anim.idleClip.name));
          w.e.setNpcDo(opts.npcKey, null);
        }

        // for respawn
        npc.position.setY(positionY);
        npc.rotation.y = rotationY;

        return npc;
      },
      async spawn({ npcKey, at, as, angle, facing }) {
        if (typeof npcKey !== "string" || !npcKeyPattern.test(npcKey)) {
          throw Error(`opts.npcKey must match: ${npcKeyPattern}`);
        }
        if (!at) {
          throw Error("opts.at must exist");
        }

        const groundAt = helper.parseGroundPoint(at);
        const gmRoomId = w.e.findRoomContaining(at, true);
        if (gmRoomId === null) throw Error("must be in some room");

        // testing early avoids creating unspawnable npc
        // - throw if doable but occupied
        // - throw if not doable and not navigable
        const doResult = state.findFreeDoMeta(at?.meta ?? {}, npcKey);
        if (doResult.type === "occupied") {
          throw Error("occupied");
        }
        const closePolyResult = state.getClosestPoly(groundAt);
        if (closePolyResult.success === false && doResult.type === "none") {
          throw Error("not placable");
        }

        const prevIdleClip = w.n[npcKey]?.anim.idleClip;
        const playerExisted = w.player.key in w.n;

        const npc = state.rawSpawn({ npcKey, doResult, groundPoint: groundAt, angle, as, closePolyResult, facing });

        w.shadows?.onTick(); // ensure shadow visible even when paused
        w.rings?.onTick();

        if (npc.spawns++ === 0) {
          await new Promise<string>((resolve) => {
            npc.resolve.spawn = resolve;
            state.update();
          });
          npc.anim.playIdleClip(0); // after mount
        } else {
          if (as) npc.setSkin(as);
          if (prevIdleClip !== npc.anim.idleClip) npc.anim.playIdleClip(0); // before update
          w.view.forceUpdate(0.01);
        }

        if (!playerExisted && w.client === false) {
          w.player.key = npcKey;
          await w.player.ensure();
        }

        w.events.next({ key: "spawned", npcKey, gmRoomId });
      },
      warmCrowd() {
        if (w.client === true) return; // clients never path-find
        const rooms = w.gmRoomGraph.nodesArray.filter((node) => node.type === "room");
        if (rooms.length < 2 || Object.keys(state.crowd.agents).length > 0) {
          return;
        }

        const from = state.getClosestPoly(rooms[0].astar.centroid, "0.5");
        const to = state.getClosestPoly(rooms[rooms.length - 1].astar.centroid, "0.5");
        if (from.success === false || to.success === false) {
          return;
        }

        const agentId = crowdApi.addAgent(state.crowd, w.nav.navMesh, from.position, getAgentParams());
        crowdApi.requestMoveTarget(state.crowd, agentId, to.nodeRef, to.position);
        // enough updates to carry the search through its quick pass and into the sliced one, which
        // is where the cost lives
        for (let i = 0; i < warmCrowdTicks; i++) {
          crowdApi.update(state.crowd, w.nav.navMesh, 1 / 60);
        }
        crowdApi.removeAgent(state.crowd, agentId);
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

        w.setNextPending({ gltf: true });

        // 🚧 avoid SVG load in prod
        const cacheBust = getDevCacheBustQueryParam();
        const [gltf, sheetImages, { manifest: skinManifest, skinKeyToSvgOverride }] = await Promise.all([
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
        const { ct } = w.texSkin;

        ct.imageSmoothingEnabled = false;
        skinEntries.forEach(({ sheetId, rect }, i) => {
          ct.clearRect(0, 0, tw, th);
          const svgImage = skinKeyToSvgOverride[skinEntries[i].key];
          if (svgImage) {
            ct.drawImage(svgImage, 0, 0, tw, th);
          } else {
            ct.drawImage(sheetImages[sheetId], rect.x, rect.y, rect.width, rect.height, 0, 0, tw, th);
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
    const clips = mapValues(
      fromAnimationClipKey,
      (_, clipName) => anims.find((c) => c.name === clipName) ?? emptyAnimationClip,
    );
    const pairedClips = keys(clips).map((clipName) => [state.clips[clipName], clips[clipName]] as const);
    Object.assign(state.clips, clips);

    /** on new clips fade old ones, else hmr can break animations */
    for (const npc of Object.values(state.npc)) {
      npc.anim.moveClip = clips[npc.anim.moveClip.name as AnimationClipKey] ?? clips.walk;
      npc.anim.idleClip = clips[npc.anim.idleClip.name as AnimationClipKey] ?? clips[defaultIdleAnimationClipKey];
      for (const [oldClip, clip] of pairedClips) {
        if (oldClip === clip) continue;
        const oldAct = npc.anim.mixer.existingAction(oldClip);
        if (!oldAct || !oldAct.isRunning()) continue;
        const act = npc.anim.mixer.clipAction(clip);
        crossFadeSynchronized(oldAct, act, 0);
      }
    }

    state.skin = { entries: queryData.skinEntries, manifest: queryData.skinManifest };
    w.setNextPending({ gltf: false, skins: false });
  }, [queryData]);

  w.r3fStore = useReactThreeFiberStore();

  useEffect(
    () => void (import.meta.env.DEV && state.devHotReload()),
    [queryData?.gltf, w.view.playerLight.uid, w.view.fadeRoomsFx.uid],
  );

  return (
    state.gltf &&
    Object.values(state.npc).map((npc) => <MemoNpcInstance key={npc.key} npc={npc} epochMs={npc.epochMs} />)
  );
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

  byAgentId: Record<string, Npc>;
  byPickId: Record<number, Npc>;
  nextPickId: number;
  npc: Record<string, Npc>;
  physics: { positions: number[] } & PhysicsBijection;
  postCrowdTickEvents: JshCli.Event[];

  /** Leaves `npc` exactly where it is, at rest — a moving agent would otherwise slide on */
  clearMomentum(npc: Npc): void;
  configureCrowd(): void;
  /** Keeps every npc's `mrtNode` in step with `w.view.npcMaskMrt` */
  syncOutlineMask(): void;
  createMaterials(
    pickId: number,
    skinIndex: number,
  ): Pick<
    NpcInit,
    | "brightness"
    | "colorScale"
    | "labelVisible"
    | "labelYShiftUniform"
    | "maskMrt"
    | "npcLit"
    | "pickIdUniform"
    | "roomSlot"
    | "skinIndexUniform"
    | "material"
  >;
  /**
   * Renumbers every npc's `pickId` from `0`, closing the gaps removals leave — so `nextPickId`,
   * and the label texture array it indexes, stay small
   */
  compactPickIds(): void;
  /** Fresh materials for `npc`, carrying over the uniforms that hold live state. Bumps `epochMs` */
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
  findFreeDoMeta(meta: Meta, npcKey: string): JshCli.FindDoMetaResult;
  getClosestPoly(
    targetPos: JshCli.PointAnyFormat,
    accuracy?: "0.005" | "0.1" | "0.5",
    queryFilter?: QueryFilter,
  ): FindNearestPolyResult;
  get(npcKey: string): Npc;
  getSkinIndexBySkinKey(skinKey: string): number;
  getSkinKeyBySkinIndex(skinIndex: number): string | null;
  getSkinMeta(skinKey: string): Meta;
  hasDoMeta(meta: Meta): boolean;
  /** Follows this npc with a room-aware light (a room-poly clip that refreshes on `"enter-room"`). `null`/omitted stops tracking. */
  move(opts: JshCli.MoveOpts): Promise<void>;
  onTick(delta: number): void;
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
  spawn(opts: JshCli.SpawnOpts): Promise<void>;
  /** Walks a throwaway agent whilst the map loads, so nobody pays for a cold search — see within */
  warmCrowd(): void;
};

/** Capped by the initial distance, so a short move need not start arrived */
function getArriveDistance(npc: Npc) {
  const { arrive, glide, arriveMin, arriveFraction } = npcConfig.dist;
  const base = (npc.anim.arrive ? arrive : glide)[npc.running ? "run" : "walk"];
  return Math.min(base, Math.max(arriveMin, arriveFraction * npc.last.targetDistance));
}

/** Avoidance is what makes npcs part around each other, and what spoils an arrival */
const movingUpdateFlags =
  crowdApi.CrowdUpdateFlags.ANTICIPATE_TURNS |
  crowdApi.CrowdUpdateFlags.SEPARATION |
  crowdApi.CrowdUpdateFlags.OBSTACLE_AVOIDANCE;

/** Near the goal, where detour's own slowdown must be obeyed rather than negotiated */
const arrivingUpdateFlags = crowdApi.CrowdUpdateFlags.ANTICIPATE_TURNS | crowdApi.CrowdUpdateFlags.SEPARATION;

function getAgentParams(): crowd.AgentParams {
  return {
    radius: npcConfig.dist.agentRadius,
    height: npcConfig.dist.height,
    maxAcceleration: walkMaxAcceleration,
    maxSpeed: idleAgentMaxSpeed,
    // collisionQueryRange: 1,
    // collisionQueryRange: 0.75,
    // cannot be smaller; maybe should be larger
    // collisionQueryRange: 0.5,
    collisionQueryRange: 0.5 + 0.1,
    separationWeight: idleSeparationWeight,
    updateFlags: movingUpdateFlags,
    // crowdApi.CrowdUpdateFlags.OPTIMIZE_TOPO |
    // crowdApi.CrowdUpdateFlags.OPTIMIZE_VIS,
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

/** How many crowd updates the warm-up runs, enough to reach the sliced search */
const warmCrowdTicks = 4;

/** Past this many pick ids handed out, a spawn renumbers them — see `compactPickIds` */
const compactPickIdsAt = 200;

const npcKeyPattern = /^[a-z][a-z0-9-]*$/;
const closePolygonDistance = 0.005;
const mediumPolygonDistance = 0.1;
const farPolygonDistance = 0.5;

const byAccuracy: Record<"0.005" | "0.1" | "0.5", { halfExtents: Vec3; distance: number }> = {
  "0.005": {
    halfExtents: [closePolygonDistance, closePolygonDistance, closePolygonDistance],
    distance: closePolygonDistance,
  },
  "0.1": {
    halfExtents: [mediumPolygonDistance, mediumPolygonDistance, mediumPolygonDistance],
    distance: mediumPolygonDistance,
  },
  "0.5": { halfExtents: [farPolygonDistance, farPolygonDistance, farPolygonDistance], distance: farPolygonDistance },
};

/**
 * The rim around an npc: how tightly it hugs the silhouette (higher is narrower), how bright it
 * gets, and what colour it glows
 */
const rimPower = 5;
const rimAmount = 0.2;
const rimColor = vec3(0.55, 0.72, 0.7);

/**
 * How bright it is instead when looking straight down — where nearly every surface in sight is a
 * flank turned edge-on, and a rim would take the whole npc — and the view elevations it eases
 * between: `0` is level with them, `1` directly above
 */
const rimOverheadAmount = 0.05;
/**
 * How much of an npc's room fade their own takes, at the near end of it — the stretch over which
 * their sphere closes or opens and their colour drains or returns. `1` is the whole of it
 */
const npcFadeShare = 0.3;

/**
 * The sphere an npc fades in and out of, in MODEL units — `npcScale` is applied to the group they
 * hang off, so these are not metres. Centred at their FEET, so the last of them to go is what they
 * stand on and the wipe reads top to bottom; centred at their middle it closed on the waist instead
 */
const npcSphereY = 0;
/**
 * Big enough to hold the model in ANY pose, not just standing: measured from the feet, and lying
 * down puts the head as far off horizontally as standing puts it vertically. Too small and parts of
 * somebody lying down are cut whilst they are fully shown; too large and the wipe is over early
 */
const npcSphereRadius = 2.4;

/**
 * How much of their own colour a LIT npc keeps where the player's light does not reach them — the
 * least they are ever seen at, the player's light being taken over it wherever it is brighter.
 * See `setNpcLit`
 */
const npcLitUnseen = 0.5;
const rimOverheadFrom = 0.45;
const rimOverheadTo = 0.85;

const labelHw = 0.5;
const labelHh = 0.125;

const emptyMeta = {};

import.meta.hot?.on("vite:beforeUpdate", (payload) => {
  const updatedThisFile = payload.updates.some((update) => update.path.endsWith("NPCs.tsx"));
  if (import.meta.hot && updatedThisFile) {
    // used to ignore stale queryFn and trigger fresh one
    import.meta.hot.data.__JUST_HMR_NPCS__ = true;
  }
});
