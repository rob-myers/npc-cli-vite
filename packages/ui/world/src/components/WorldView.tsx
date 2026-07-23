import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, ExhaustiveError, useStateRef } from "@npc-cli/util";
import { Poly, Vect } from "@npc-cli/util/geom";
import { geomService } from "@npc-cli/util/geom-service";
import { getRelativePointer, isRMB } from "@npc-cli/util/legacy/dom";
import {
  testNever,
  tryLocalStorageGet,
  tryLocalStorageGetParsed,
  tryLocalStorageSet,
} from "@npc-cli/util/legacy/generic";
import { type MapControlsProps, PerspectiveCamera, Stats } from "@react-three/drei";
import { Canvas, type RootState } from "@react-three/fiber";
import type { DefaultGLProps } from "@react-three/fiber/dist/declarations/src/core/renderer";
import debounce from "debounce";
import { AnimatePresence, motion } from "motion/react";
import { useContext, useEffect } from "react";
import { colorBleeding } from "three/addons/tsl/display/CRT.js";
import { float, instanceIndex, mix, output, pass, select, uniform, vec3, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import {
  ambientIntensityKey,
  ambientMoodKey,
  cameraModeStorageKey,
  defaultAmbientIntensity,
  defaultCameraMode,
  defaultCardinalDirectionsDesktop,
  defaultCardinalDirectionsMobile,
  defaultDesktopFov,
  defaultMobileFov,
  defaultRoomLightIntensity,
  defaultTargetLightRadius,
  defaultTrackedLightIntensity,
  fovStorageKey,
  nearbyDoorMergeExtensionDepth,
  numCardinalDirectionsKey,
  postProcessingEnabledKey,
  roomLightEditingEnabledKey,
  roomLightIntensityKey,
  roomLightingEnabledKey,
  trackedLightIntensityKey,
  trackedLightRadiusKey,
  trackedLightRoomOutset,
  wallHeight,
} from "../const";
import type { CameraControls as BaseCameraControls } from "../service/camera-controls";
import { computeIntersectionNormal, getTempInstanceMesh } from "../service/geometry";
import { decodePick } from "../service/pick";
import { createRoomLightPostprocess, type RoomLightPostprocess } from "../service/room-light-postprocess";
import { type AmbientMood, computeDimWorldColor, type SelectAnyType } from "../service/texture";
import { createTrackedLightPostprocess, type TrackedLightPostprocess } from "../service/tracked-light-postprocess";
import { CameraControls, type CameraModeType } from "./CameraControls";
import NpcBubbles from "./NpcBubbles";
import { WorldContext } from "./world-context";

export function WorldView(props: React.PropsWithChildren<{ className?: string }>) {
  const { uiStoreApi } = useContext(UiContext);
  const w = useContext(WorldContext);
  const initialAmbientIntensity = tryLocalStorageGetParsed<number>(ambientIntensityKey) ?? defaultAmbientIntensity;
  const initialAmbientMood = tryLocalStorageGetParsed<AmbientMood>(ambientMoodKey) ?? null;

  const state = useStateRef(
    (): State => ({
      cameraMode: tryLocalStorageGet<CameraModeType>(cameraModeStorageKey) ?? defaultCameraMode,
      numCardinalDirections:
        tryLocalStorageGetParsed<number>(numCardinalDirectionsKey) ??
        (w.touchDevice ? defaultCardinalDirectionsMobile : defaultCardinalDirectionsDesktop),
      canvas: null as any,
      controls: null as any,
      clickIds: [],
      topDown: false,
      ctrlOpts: {
        minAzimuthAngle: -Infinity,
        maxAzimuthAngle: +Infinity,
        minPolarAngle: Math.PI / 64,
        maxPolarAngle: Math.PI / 2 - Math.PI / 8,
        minDistance: w.touchDevice ? 5 : 4,
        maxDistance: 16,
        extraZoom: 2,
        panSpeed: 2,
        rotateSpeed: 0.5,
        zoomSpeed: 0.3,
      },
      initial: {
        azimuthal: 0,
        polar: Math.PI / 8,
        position: { x: 4, y: 10, z: 4 },
      },
      lastPointer: {
        epochMs: 0,
        longPressTimer: 0,
        longPress: false,
        move: new Vect(),
        down: new Vect(),
        rightPress: false,
      },
      pickRT: new THREE.RenderTarget(1, 1, { format: THREE.RGBAFormat }),
      raycaster: new THREE.Raycaster(),
      objectPick: uniform(0),
      objectPickScale: 0.5, // don't pick walls by default
      postProcessing: tryLocalStorageGetParsed<boolean>(postProcessingEnabledKey) ?? true,
      dimWorldColor: uniform(computeDimWorldColor(initialAmbientIntensity, initialAmbientMood)),
      ambientIntensity: initialAmbientIntensity,
      ambientMood: initialAmbientMood,
      roomLight: createRoomLightPostprocess({
        roomLightingEnabled: tryLocalStorageGetParsed<boolean>(roomLightingEnabledKey) ?? true,
        bottomHeight: 0,
        topHeight: wallHeight + 0.5, // cover npc on top-bunk
      }),
      roomLightIntensity: uniform(tryLocalStorageGetParsed<number>(roomLightIntensityKey) ?? defaultRoomLightIntensity),
      trackedLightIntensity: uniform(
        tryLocalStorageGetParsed<number>(trackedLightIntensityKey) ?? defaultTrackedLightIntensity,
      ),
      /** Toggled via long-press on WorldMenu's lights icon; gates long-press room toggling */
      roomLightEditingEnabled: tryLocalStorageGetParsed<boolean>(roomLightEditingEnabledKey) ?? true,
      trackedLight: createTrackedLightPostprocess({ bottomHeight: 0, topHeight: wallHeight + 0.5 }),
      light: {
        displayCenter: new THREE.Vector3(),
        /** Set by `w.npc.trackNpc`; a live reference, so a moving target (e.g. `npc.position`) is tracked */
        targetOverride: null as null | { x: number; y: number; z: number },
        /** Set by `w.npc.trackNpc`; lets the `"enter-room"` handler know which npc's room-transitions should refresh the tracked light's room-poly clip */
        trackedNpcKey: null as string | null,
        /** Tracked-light radius — persisted, settable via `w.view.setTrackedLightRadius` */
        radius: tryLocalStorageGetParsed<number>(trackedLightRadiusKey) ?? defaultTargetLightRadius,
        /** Encoded (gmId, doorId) of each door bordering the tracked room, for per-frame live open-ratio reads (see `onCameraChange`) — same order as last passed to `trackedLight.setTrackedRoomDoors` */
        doorInstanceIds: [] as number[],
        /** Door whose "inside" sensor zone `checkTrackedDoorCrossing` is currently pinned to, else `null` */
        doorCrossGdKey: null as Geomorph.GmDoorKey | null,
        /** Last known side of `doorCrossGdKey` (index into its `connector.roomIds`), else `null` */
        doorCrossSign: null as 0 | 1 | null,
        /** Room last passed to `switchTrackedNpcRoom`/set by `w.npc.trackNpc` — lets a room switch
         * look back at the room just left (see `nearbyDoorMergeDist`), else `null` */
        currentGmRoomId: null as Geomorph.GmRoomId | null,
      },
      fov: tryLocalStorageGetParsed<number>(fovStorageKey) ?? (w.touchDevice ? defaultMobileFov : defaultDesktopFov),

      async createRenderer(props) {
        // 🔔 fix mismatched canvas size on chrome re-open tab (cmd+shift+t)
        // - "The depth stencil attachment [TextureView of Texture "depthBuffer"] size (width: 300, height: 150) does not match the size of the other attachments' base plane (width: 1190, height: 1296). "
        const canvas = props.canvas as HTMLCanvasElement;
        const parent = w.rootEl as HTMLDivElement;
        const parentRect = parent.getBoundingClientRect();
        if (parentRect.width > 0 && parentRect.height > 0) {
          canvas.width = parentRect.width * devicePixelRatio;
          canvas.height = parentRect.height * devicePixelRatio;
        }

        const renderer = new THREE.WebGPURenderer({
          canvas,
          alpha: true,
          antialias: true,
          logarithmicDepthBuffer: true,
          powerPreference: "high-performance",
        });
        renderer.onDeviceLost = (event) => {
          console.warn("WebGPU device lost", event);
        };
        renderer.setPixelRatio(window.devicePixelRatio);

        await renderer.init();
        return renderer;
      },
      forceUpdate(delta = 0) {
        w.npc.onTick(delta);
        w.r3f?.invalidate();
        w.update();
      },
      getPickedFromPixel([r, g, b, _a]) {
        // console.log(`pixel`, { r, g, b, a: _a });
        const pick = decodePick(r, g, b);

        if (pick === null) {
          return null;
        }

        switch (pick.type) {
          case "floor": {
            const gmId = pick.instanceId;
            const gm = w.gms[gmId];
            if (!gm) return null;
            return { ...pick, gmId, gmKey: gm.key, floor: true };
          }
          case "ceiling": {
            const gmId = pick.instanceId;
            const gm = w.gms[gmId];
            if (!gm) return null;
            return { ...pick, gmId, gmKey: gm.key, ceiling: true };
          }
          case "wall": {
            const decoded = w.wall.decodeInstanceId(pick.instanceId);
            return { ...pick, wall: true, ...decoded };
          }
          case "obstacle": {
            const decoded = w.obs.decodeInstanceId(pick.instanceId);
            return { ...pick, obstacle: true, ...decoded };
          }
          case "door": {
            const decoded = w.door.decodeInstanceId(pick.instanceId);
            return { ...pick, door: true, ...decoded };
          }
          case "decor": {
            const decoded = w.decor.decodeStaticInstanceId(pick.instanceId);
            if (!decoded) return null;
            return { ...pick, decor: true, ...decoded, decorKey: decoded.decorKey };
          }
          case "runtimeDecor": {
            const decoded = w.decor.decodeRuntimeInstanceId(pick.instanceId);
            if (!decoded) return null;
            return { ...pick, type: "decor", decor: true, runtime: true, ...decoded, decorKey: decoded.decorKey };
          }
          case "debugPoint": {
            const decoded = w.debug.decodeDebugPointInstanceId(pick.instanceId);
            if (!decoded) return null;
            return { ...pick, debugPoint: true, ...decoded };
          }
          case "npc": {
            const npc = w.npc.byPickId[pick.instanceId];
            if (npc) return { ...pick, npcKey: npc.key, ...w.e.npcToRoom.get(npc.key) };
            return null;
          }
          default:
            throw new ExhaustiveError(pick);
        }
      },
      getRaycastIntersection(e, picked) {
        let mesh: THREE.Mesh;

        // handle fractional device pixel ratio e.g. 2.625 on Pixel
        const glPixelRatio = w.r3f.gl.getPixelRatio();
        const { left, top } = (e.target as HTMLElement).getBoundingClientRect();

        const normalizedDeviceCoords = new THREE.Vector2(
          -1 + 2 * (((e.clientX - left) * glPixelRatio) / w.view.canvas.width),
          +1 - 2 * (((e.clientY - top) * glPixelRatio) / w.view.canvas.height),
        );
        w.view.raycaster.setFromCamera(normalizedDeviceCoords, state.controls?.object ?? w.r3f.camera);

        switch (picked.type) {
          case "floor":
            mesh = getTempInstanceMesh(w.floor.inst as THREE.InstancedMesh, picked.instanceId);
            break;
          case "wall":
            mesh = getTempInstanceMesh(w.wall.inst as THREE.InstancedMesh, picked.instanceId);
            break;
          case "npc":
            mesh = w.npc.npc[picked.npcKey].skinnedMesh;
            break;
          case "door":
            mesh = getTempInstanceMesh(w.door.inst as THREE.InstancedMesh, picked.instanceId);
            break;
          case "obstacle":
            mesh = getTempInstanceMesh(w.obs.inst as THREE.InstancedMesh, picked.instanceId);
            break;
          case "ceiling":
            mesh = getTempInstanceMesh(w.ceil.inst as THREE.InstancedMesh, picked.instanceId);
            break;
          case "decor":
            if (picked.runtime) {
              mesh = getTempInstanceMesh(w.decor.instRuntime as THREE.InstancedMesh, picked.instanceId);
            } else {
              mesh = getTempInstanceMesh(w.decor.inst as THREE.InstancedMesh, picked.instanceId);
            }
            break;
          case "debugPoint":
            mesh = getTempInstanceMesh(w.debug.debugPointsInst as THREE.InstancedMesh, picked.instanceId);
            break;
          default:
            throw testNever(picked);
        }

        const [intersection] = state.raycaster.intersectObject(mesh);
        if (!intersection) return null;

        intersection.normal = computeIntersectionNormal(mesh, intersection);
        return intersection;
      },
      isPointDiffDrag(pointA, pointB) {
        return tmpVect.copy(pointA).distanceTo(pointB) > (w.touchDevice === true ? 20 : 5);
      },
      onCreated(rootState) {
        w.threeReady = true;
        // override THREE.WebGPURenderer
        w.r3f = rootState as Omit<typeof rootState, "gl"> as typeof w.r3f;
        // re-upload textures on new GPU context (e.g. Chrome cmd+shift+t double init)
        w.texFloor.update();
        w.update();
      },
      onResize: debounce(() => {
        w.menu?.onResize();
        w.speech?.onResize();
      }, 100),
      onKeyDown(e) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (e.key === "Escape") {
          uiStoreApi.setUiMeta(w.id, (draft) => (draft.disabled = true));
        } else if (e.key === "Enter") {
          uiStoreApi.setUiMeta(w.id, (draft) => (draft.disabled = false));
        }
      },
      onPointerDown(e) {
        const last = state.lastPointer;
        clearTimeout(last.longPressTimer);
        last.down.copy(getRelativePointer(e));
        last.epochMs = Date.now();
        last.longPress = false;
        last.rightPress = isRMB(e.nativeEvent);

        const modifier = e.shiftKey === true || e.ctrlKey === true || e.metaKey === true;
        state.canvas.style.cursor = modifier ? "grabbing" : "move";

        last.longPressTimer = window.setTimeout(() => {
          last.longPress = true;
          if (state.isPointDiffDrag(last.down, last.move) === true) {
            return; // drag is not long press
          }
          state.pickObject(e);
        }, 500);
      },
      onPointerLeave(_e) {
        clearTimeout(state.lastPointer.longPressTimer);
        state.lastPointer.longPressTimer = 0;
        state.canvas.style.cursor = "";
      },
      onPointerMove(e) {
        state.lastPointer.move.copy(getRelativePointer(e));
      },
      async onPointerUp(e) {
        const last = state.lastPointer;
        clearTimeout(last.longPressTimer);
        last.longPressTimer = 0;
        state.canvas.style.cursor = "";
        e.currentTarget.focus();

        if (last.longPress === true) {
          return; // already picked
        }
        if (state.isPointDiffDrag(last.down, getRelativePointer(e)) === true) {
          return; // drag is not a pick
        }
        state.pickObject(e);
      },
      async pickObject(e) {
        const { gl, scene, camera } = w.r3f;
        const renderer = gl as unknown as THREE.WebGPURenderer;

        const x = Math.floor(e.nativeEvent.offsetX * gl.getPixelRatio());
        const y = Math.floor(e.nativeEvent.offsetY * gl.getPixelRatio());

        const rt = state.pickRT;
        const rtCamera = camera;
        const size = new THREE.Vector2();
        renderer.getDrawingBufferSize(size);
        rtCamera.setViewOffset(size.x, size.y, x, y, 1, 1);

        state.objectPick.value = 1 * state.objectPickScale;
        renderer.setRenderTarget(rt);
        renderer.render(scene, rtCamera);
        state.objectPick.value = 0;
        renderer.setRenderTarget(null);
        rtCamera.clearViewOffset();

        const rgba = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, 1, 1);
        const picked = state.getPickedFromPixel(rgba);
        if (picked === null) return;

        const intersection = state.getRaycastIntersection(e.nativeEvent, picked);
        // console.log("picked", picked, intersection);
        if (intersection === null) return;

        const { distance, point } = intersection;
        // always take 1st -- see `pick` for execution order
        const clickId = state.clickIds.shift();

        // npc might lack gmId
        const gmRoomId = "gmId" in picked ? w.e.findRoomContaining(point, true) : null;

        w.events.next({
          key: "picked",
          ...(clickId && { clickId: clickId.id }),
          meta: {
            ...picked,
            ...gmRoomId,
            nav: picked.type === "floor" && w.npc.getClosestPoly(point).success,
            do:
              // picked decor with meta.do string
              (picked.type === "decor" && !!w.decor.byKey[picked.decorKey]?.meta.do) ||
              // picked obstacle with meta.decorIds array
              (picked.type === "obstacle" && !!w.gms[picked.gmId].obstacles[picked.obstacleId].meta.decorIds),
          },
          gmRoomId,

          distance,
          point: point.toArray(), // better for CLI
          faceIndex: intersection.faceIndex,
          normal: intersection.normal,

          longDown: state.lastPointer.longPress,
          rightDown: state.lastPointer.rightPress,

          ...point, // can provide as point with meta
        });
      },
      onCameraChange(spherical: THREE.Spherical, _target: THREE.Vector3) {
        const topDown = spherical.phi <= 2 * (Math.PI / 18);
        if (topDown !== state.topDown) {
          state.topDown = topDown;
          w.events.next({ key: topDown ? "enter-topdown" : "exit-topdown" });
        }

        // refresh the shared camera matrices on every rendered frame — so lighting keeps rendering
        // correctly (rather than with stale matrices) as the camera pans/rotates/zooms, even while
        // paused (when `updateLight` isn't advancing `light.displayCenter`)
        const camera = state.controls?.object ?? w.r3f.camera;
        state.roomLight.update(camera);
        state.trackedLight.update(camera);

        // only push a center-refresh while genuinely tracking a target — `setTracked` with a
        // non-null center always sets active=1, so this must not fire once tracking is turned off
        // (radius omitted -> keeps whatever `trackNpc` set it to)
        if (state.light.targetOverride !== null) {
          state.trackedLight.setTracked({ x: state.light.displayCenter.x, z: state.light.displayCenter.z });
          // live per-door openness, read fresh every frame (cheap — a handful of float reads) so
          // the "lit through an open door" reach fades smoothly as a door actually slides open
          state.trackedLight.setDoorOpenRatios(state.light.doorInstanceIds.map((id) => w.door.openRatioArray[id]));
        }
      },
      updateLight(rawTarget) {
        state.light.displayCenter.copy(rawTarget);
        w.e.checkTrackedDoorCrossing();
      },
      // 🚧 precompute these
      computeRoomOutline(gmRoomId) {
        const gm = w.gms[gmRoomId.gmId];
        const room = gm.rooms[gmRoomId.roomId];
        const [outsetRoom] = geomService.createOutset(room.clone(), 0.05);

        const hullDoorExtensions = gm.doors
          .filter((d) => d.meta.hull === true && d.roomIds.includes(gmRoomId.roomId))
          .map((d) => d.computeThinPoly(0.2));

        const merged = hullDoorExtensions.length
          ? Poly.union([outsetRoom, ...hullDoorExtensions]).reduce((a, b) =>
              a.outline.length >= b.outline.length ? a : b,
            )
          : outsetRoom;

        return merged.cleanClone(gm.matrix).outline.map((p) => ({ x: p.x, z: p.y }));
      },
      computeRoomDoors(gmRoomId) {
        const gm = w.gms[gmRoomId.gmId];
        return gm.doors
          .map((d, doorId) => ({ d, doorId }))
          .filter(({ d }) => d.roomIds.includes(gmRoomId.roomId))
          .flatMap(({ d, doorId }) => {
            const a = gm.matrix.transformPoint({ x: d.seg[0].x, y: d.seg[0].y });
            const b = gm.matrix.transformPoint({ x: d.seg[1].x, y: d.seg[1].y });

            // find the room on the OTHER side of this door — same gm for a non-hull door, a
            // different gm instance (via the gm-graph) for a hull door
            let otherGm = gm;
            let otherRoomId: number | null = null;
            if (d.meta.hull === true) {
              const adj = w.gmGraph.getAdjacentRoomCtxt(gmRoomId.gmId, doorId);
              if (adj !== null) {
                otherGm = w.gms[adj.adjGmId];
                otherRoomId = adj.adjRoomId;
              }
            } else {
              otherRoomId = d.roomIds.find((id) => id !== null && id !== gmRoomId.roomId) ?? null;
            }
            if (otherRoomId === null) {
              return []; // e.g. a hull door at the map edge, nothing on the other side
            }

            const outsetOtherRoom = geomService.createOutset(
              otherGm.rooms[otherRoomId].clone(),
              trackedLightRoomOutset,
            );
            const extendedOther = outsetOtherRoom.reduce((x, y) => (x.outline.length >= y.outline.length ? x : y));
            const otherRoomWorld = extendedOther.cleanClone(otherGm.matrix);

            return [
              {
                a: { x: a.x, z: a.y },
                b: { x: b.x, z: b.y },
                adjRoomOutline: otherRoomWorld.outline.map((p) => ({ x: p.x, z: p.y })),
                instanceId: w.door.encodeGmDoorId(gmRoomId.gmId, doorId),
              },
            ];
          });
      },
      extendRoomOutlineNearDoors(outline, gdKeys, safetyPoint) {
        if (gdKeys.length === 0) {
          return outline;
        }
        const roomPoly = new Poly(outline.map((p) => new Vect(p.x, p.z)));
        const doorPolysWorld = gdKeys.map((gdKey) => {
          const door = w.d[gdKey];
          const gm = w.gms[door.gmId];
          return door.connector.computeThinPoly(nearbyDoorMergeExtensionDepth).cleanClone(gm.matrix);
        });
        const merged = Poly.union([roomPoly, ...doorPolysWorld]);
        const extended = merged.reduce((a, b) => (a.outline.length >= b.outline.length ? a : b));
        // defensive: unioning several thin door-polys at once (e.g. 3+ doors clustered at a
        // junction) can occasionally split into disjoint pieces where "largest by vertex count"
        if (!extended.contains(safetyPoint)) {
          return outline;
        }
        return extended.cleanClone().outline.map((p) => ({ x: p.x, z: p.y }));
      },
      toggleRoomLightEditing() {
        state.roomLightEditingEnabled = !state.roomLightEditingEnabled;
        tryLocalStorageSet(roomLightEditingEnabledKey, String(state.roomLightEditingEnabled));
        w.update();
      },
      setRoomLightingEnabled(next = state.roomLight.roomLightingEnabled.value === 0) {
        state.roomLight.setRoomLightingEnabled(next);
        tryLocalStorageSet(roomLightingEnabledKey, String(next));
        state.setPostProcessingEnabled(true);
      },
      setRoomLightIntensity(next) {
        state.roomLightIntensity.value = next;
        tryLocalStorageSet(roomLightIntensityKey, String(next));
        state.setPostProcessingEnabled(true);
        state.forceUpdate();
      },
      setTrackedLightRadius(next) {
        state.light.radius = next;
        if (state.light.targetOverride !== null) {
          state.trackedLight.setTracked({ x: state.light.displayCenter.x, z: state.light.displayCenter.z }, next);
        }
        tryLocalStorageSet(trackedLightRadiusKey, String(next));
        state.setPostProcessingEnabled(true);
        state.forceUpdate();
      },
      setTrackedLightIntensity(next) {
        state.trackedLightIntensity.value = next;
        tryLocalStorageSet(trackedLightIntensityKey, String(next));
        state.setPostProcessingEnabled(true);
        state.forceUpdate();
      },
      setAmbientIntensity(next) {
        state.ambientIntensity = next;
        state.dimWorldColor.value.copy(computeDimWorldColor(next, state.ambientMood));
        tryLocalStorageSet(ambientIntensityKey, String(next));
        state.setPostProcessingEnabled(true);
        state.forceUpdate();
      },
      setAmbientMood(next) {
        state.ambientMood = state.ambientMood === next ? null : next;
        state.dimWorldColor.value.copy(computeDimWorldColor(state.ambientIntensity, state.ambientMood));
        tryLocalStorageSet(ambientMoodKey, JSON.stringify(state.ambientMood));
        state.setPostProcessingEnabled(true);
        state.forceUpdate();
      },
      roomLightingDisallowed(gmRoomId) {
        const roomDecor = w.decor.byRoom[gmRoomId.gmId]?.[gmRoomId.roomId];
        // ≤ 1 or 1st takes precedence
        const decorLabel = roomDecor
          ?.values()
          .find((d): d is Geomorph.DecorPoint => d.type === "point" && typeof d.meta.label === "string");
        return decorLabel === undefined || decorLabel.meta.label === "corridor" || decorLabel.meta.unlit === true;
      },
      toggleRoomLit(groundCenter) {
        const gmRoomId = w.e.findRoomContaining(groundCenter, true);
        if (!gmRoomId) {
          return; // must be in some room
        }
        if (state.roomLightingDisallowed(gmRoomId)) {
          return; // lighting isn't permitted in this room
        }
        const { gmId, roomId } = gmRoomId;
        state.roomLight.setRoomLit(gmId, roomId, !state.roomLight.isRoomLit(gmId, roomId));
        state.setPostProcessingEnabled(true);
        state.forceUpdate();
      },
      resetAllRooms() {
        state.roomLight.resetAllRooms();
        state.setPostProcessingEnabled(true);
      },
      setCameraMode(mode) {
        state.cameraMode = mode;
        tryLocalStorageSet(cameraModeStorageKey, mode);
        w.update();
      },
      setNumCardinalDirections(n) {
        tryLocalStorageSet(numCardinalDirectionsKey, String(n));
        state.set({ numCardinalDirections: n });
      },
      setPostProcessingEnabled(next = !state.postProcessing) {
        state.postProcessing = next;
        tryLocalStorageSet(postProcessingEnabledKey, String(next));
        state.forceUpdate();
      },
      setupPostProcessing() {
        const { gl, scene, camera } = w.r3f;
        const scenePass = pass(scene, camera);
        const sceneColor = scenePass.getTextureNode("output");
        // raw logarithmic depth — litAmount() (room + tracked) does its own log-depth inversion
        const sceneDepth = scenePass.getTextureNode("depth");
        // "bright" if a lit room's own (scaled-down) brightness OR the tracked light reaches here —
        // combine via max BEFORE inverting, not after: this way a lit room whose own intensity is
        // below 1 still lets the tracked light stand out above it, instead of one flattening the other.
        const isBright = state.roomLight
          .litAmount(sceneDepth.r)
          .mul(state.roomLightIntensity)
          .max(state.trackedLight.litAmount(sceneDepth.r).mul(state.trackedLightIntensity));
        const unlitAmount = float(1).sub(isBright);
        const effect = mix(
          // fully-lit scaled down
          colorBleeding(sceneColor, uniform(0.0025)).mul(vec3(1), sceneColor.a),
          // darkness
          sceneColor.rgb.mul(state.dimWorldColor),
          unlitAmount,
        );

        const pipeline = new THREE.RenderPipeline(gl);
        pipeline.outputNode = vec4(effect, sceneColor.a);

        const originalRender = gl.render.bind(gl);
        let inPipeline = false;
        gl.render = (s: THREE.Scene, c: THREE.Camera) => {
          if (!inPipeline && gl.getRenderTarget() === null) {
            inPipeline = true;
            pipeline.render();
            inPipeline = false;
          } else {
            originalRender(s, c);
          }
        };
        w.isReady() && state.forceUpdate();

        return () => {
          gl.render = originalRender;
          pipeline.dispose();
          state.forceUpdate();
        };
      },
      syncRenderMode() {
        if (w.disabled === true) {
          w.r3f?.set({ frameloop: "demand" });
          return "demand";
        } else {
          w.r3f?.set({ frameloop: "always" });
          return "always";
        }
      },
      withPickOutput(typeId, forceAlpha) {
        const idx = float(instanceIndex);
        const pickVec = vec4(
          float(typeId).div(255),
          idx.div(256).floor().div(255),
          idx.mod(256).div(255),
          forceAlpha ?? output.a,
        );
        // 🔔 SelectAnyType fixes horrible: Expression produces a union type that is too complex to represent.
        return (select as SelectAnyType)(state.objectPick.notEqual(0), pickVec, output);
      },
      withPickOutputId(typeId, idUniform) {
        const idx = float(idUniform);
        const pickVec = vec4(float(typeId).div(255), idx.div(256).floor().div(255), idx.mod(256).div(255), output.a);
        return (select as SelectAnyType)(state.objectPick.notEqual(0), pickVec, output);
      },
    }),
    { reset: { ctrlOpts: true, initial: false, dimWorldColor: true, trackedLight: true } },
  );

  w.view = state;

  useEffect(() => {
    if (!w.rootEl) return;

    // only trigger when visible
    const ro = new ResizeObserver(([entry]) => {
      entry.contentRect.width && state.onResize();
    });
    ro.observe(w.rootEl);

    const { onKeyDown } = state;
    w.rootEl.addEventListener("keydown", onKeyDown);

    const onExtraZoomChange = (_e: Event) => w.update();
    w.rootEl.addEventListener("extrazoomchange", onExtraZoomChange);

    return () => {
      ro.disconnect();
      w.rootEl?.removeEventListener("keydown", onKeyDown);
      w.rootEl?.removeEventListener("extrazoomchange", onExtraZoomChange);
    };
  }, [w.rootEl, state.onKeyDown]); // debounced resize + key events

  useEffect(() => {
    // 🚧 hmr should not reset lights
    w.gms.length > 0 && state.roomLight.syncGms(w.gms, w.gmsData);
  }, [w.hash, w.gmsData]); // gm instances (or their derived per-layout data) changed

  return (
    <div className="size-full">
      <Canvas
        className={props.className}
        style={{ filter: `brightness(${w.brightness})` }}
        ref={state.ref("canvas")}
        frameloop={state.syncRenderMode()}
        gl={state.createRenderer}
        onCreated={state.onCreated}
        onPointerDown={state.onPointerDown}
        onPointerLeave={state.onPointerLeave}
        onPointerMove={state.onPointerMove}
        onPointerUp={state.onPointerUp}
        resize={{ debounce: 0 }}
        flat // 🔔 hopefully fix sporadic colorspace issues on refresh
        tabIndex={0}
      >
        <Stats
          showPanel={0}
          className={cn(w.disabled && "pointer-events-none grayscale-100", "absolute! z-0! left-[unset]! right-0")}
          parent={{ current: w.rootEl }}
        />

        <PerspectiveCamera fov={state.fov} makeDefault zoom={1} />

        <CameraControls
          ref={state.ref("controls")}
          cameraMode={state.cameraMode}
          numCardinalDirections={state.numCardinalDirections}
          domElement={state.canvas}
          initialAzimuthal={state.initial.azimuthal}
          initialPolar={state.initial.polar}
          initialPosition={state.initial.position}
          minPanDistance={w.touchDevice ? 0.05 : 0}
          onFrame={state.onCameraChange}
          {...state.ctrlOpts}
        />

        <NpcBubbles />

        {state.postProcessing && <PostProcessing />}

        {props.children}
      </Canvas>

      <AnimatePresence>
        {w.disabled && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="px-4 py-1.5 rounded-full bg-black/40 backdrop-blur-xs border border-white/20 text-white/40 text-xs font-mono tracking-[0.3em] uppercase select-none">
              paused
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export type State = {
  cameraMode: CameraModeType;
  numCardinalDirections: number;
  canvas: HTMLCanvasElement;
  clickIds: { id: string; blocking: boolean }[];
  controls: BaseCameraControls;
  topDown: boolean;
  ctrlOpts: MapControlsProps & { extraZoom?: number };
  initial: { azimuthal: number; polar: number; position: { x: number; y: number; z: number } };
  lastPointer: {
    epochMs: number;
    longPress: boolean;
    longPressTimer: number;
    move: Geom.Vect;
    down: Geom.Vect;
    rightPress: boolean;
  };
  pickRT: THREE.RenderTarget;
  raycaster: THREE.Raycaster;
  objectPick: THREE.UniformNode<"float", number>;
  /** `0` (force off), `0.5` (when on ignore walls), `1` (when on pick walls too) */
  objectPickScale: 0 | 0.5 | 1;
  postProcessing: boolean;
  roomLight: RoomLightPostprocess;
  /** Toggled via long-press on WorldMenu's lights icon; gates long-press room toggling in `use-world-events.ts` */
  roomLightEditingEnabled: boolean;
  /** Persisted, user-controlled brightness of a lit room (0..1) — see `defaultRoomLightIntensity` */
  roomLightIntensity: THREE.UniformNode<"float", number>;
  /** Persisted brightness multiplier (0..1) on the tracked light — see `defaultTrackedLightIntensity` */
  trackedLightIntensity: THREE.UniformNode<"float", number>;
  dimWorldColor: THREE.UniformNode<"vec3", THREE.Vector3>;
  /** Persisted magnitude backing `dimWorldColor` — see `defaultAmbientIntensity` */
  ambientIntensity: number;
  /** Persisted mood tint backing `dimWorldColor`, else `null` (neutral) */
  ambientMood: AmbientMood | null;
  trackedLight: TrackedLightPostprocess;
  light: LightState;
  fov: number;

  createRenderer(props: DefaultGLProps): Promise<THREE.WebGPURenderer>;
  forceUpdate(delta?: number): void;
  pickObject(e: React.PointerEvent<HTMLDivElement>): void;
  onCreated(rootState: RootState): void;
  onKeyDown(e: KeyboardEvent): void;
  onResize(): void;
  onPointerDown(e: React.PointerEvent<HTMLDivElement>): void;
  onPointerLeave(e: React.PointerEvent<HTMLDivElement>): void;
  onPointerMove(e: React.PointerEvent<HTMLDivElement>): void;
  onPointerUp(e: React.PointerEvent<HTMLDivElement>): void;
  getPickedFromPixel(rgba: THREE.TypedArray | [number, number, number, number]): Picked | null;
  getRaycastIntersection: (e: PointerEvent, picked: Picked) => null | THREE.Intersection;
  isPointDiffDrag(pointA: Geom.VectJson, pointB: Geom.VectJson): boolean;
  onCameraChange(spherical: THREE.Spherical, target: THREE.Vector3): void;
  /** Advances `light.displayCenter` from a live target — called every tick from `World`'s `onTick` while `light.targetOverride` is set (see `w.npc.trackNpc`) */
  updateLight(rawTarget: { x: number; y: number; z: number }): void;
  /** World-space outline of `gmRoomId`'s room, outset slightly (see `trackedLightRoomOutset`), unioned with adjacent doorways */
  computeRoomOutline(gmRoomId: Geomorph.GmRoomId): { x: number; z: number }[];
  /**
   * World-space segments of the doors bordering `gmRoomId`'s room, each with the outline of the
   * room on its OTHER side (so a fragment must be inside that room, not merely along the line of
   * sight, to be lit through that door) and its encoded (gmId, doorId) instance id — feeds
   * `trackedLight.setTrackedRoomDoors`/`light.doorInstanceIds`
   */
  computeRoomDoors(gmRoomId: Geomorph.GmRoomId): {
    a: { x: number; z: number };
    b: { x: number; z: number };
    adjRoomOutline: { x: number; z: number }[];
    instanceId: number;
  }[];
  /**
   * Extends a world-space room `outline` by unioning in a thin polygon straddling each of `gdKeys`
   * (see `nearbyDoorMergeExtensionDepth`) — used so a door very close to the one just crossed (e.g.
   * meeting it at a right angle) keeps a bit of its own room directly lit, not just reachable via
   * that door's own reach-slot (see `switchTrackedNpcRoom`/`nearbyDoorMergeDist`). Falls back to
   * the un-merged `outline` if the result doesn't contain `safetyPoint` (see impl. for why).
   */
  extendRoomOutlineNearDoors(
    outline: { x: number; z: number }[],
    gdKeys: Geomorph.GmDoorKey[],
    safetyPoint: Geom.VectJson,
  ): { x: number; z: number }[];
  toggleRoomLightEditing(): void;
  /** Toggles `roomLight.roomLightingEnabled` — persisted to localStorage */
  setRoomLightingEnabled(next?: boolean): void;
  /** Sets the persisted room-light intensity (0..1) — see `defaultRoomLightIntensity` */
  setRoomLightIntensity(next: number): void;
  /** Sets the tracked light's radius (persisted) — updates the live uniform if tracking is active */
  setTrackedLightRadius(next: number): void;
  /** Sets the tracked light's brightness multiplier (0..1, persisted) — see `defaultTrackedLightIntensity` */
  setTrackedLightIntensity(next: number): void;
  /** Sets the world's ambient tint magnitude (persisted) — see `defaultAmbientIntensity` */
  setAmbientIntensity(next: number): void;
  /** Sets (or clears, if already active) the world's ambient mood tint (persisted) */
  setAmbientMood(next: Exclude<AmbientMood, null>): void;
  /** No labelled decor point, or a labelled point with `meta.corridor === true` / `meta.unlit === true` — such rooms don't permit lighting at all */
  roomLightingDisallowed(gmRoomId: Geomorph.GmRoomId): boolean;
  /** Toggles whether `gmRoomId`'s room is lit, unless lighting isn't permitted there (see `roomLightingDisallowed`) */
  toggleRoomLit(groundCenter: Geom.VectJson): void;
  /** Clears every lit room */
  resetAllRooms(): void;
  setCameraMode(mode: CameraModeType): void;
  setNumCardinalDirections(n: number): void;
  syncRenderMode(): RootState["frameloop"];
  /**
   * TSL node for `outputNode`: when state.objectPick==1, outputs raw unlit pick color;
   * otherwise passes through the standard lit `output`.
   *
   * We include `colorScale` here because scaling colorNode on
   * transparent material broke picking.
   */
  withPickOutput(typeId: number, forceAlpha?: number): THREE.Node;
  /** Like `withPickOutput` but uses a uniform instead of `instanceIndex` (for non-instanced meshes). */
  withPickOutputId(typeId: number, idUniform: THREE.UniformNode<"float", number>): THREE.Node;
  setPostProcessingEnabled(next?: boolean): void;
  setupPostProcessing(): () => void;
};

/**
 * The tracked light drawn in post-processing (see `tracked-light-postprocess.ts`). Off until a
 * target is set via `w.npc.trackNpc`; once set, tracked every tick from `World`'s `onTick`. A
 * live reference (e.g. `npc.position`) is tracked automatically as it moves.
 */
export type LightState = {
  displayCenter: THREE.Vector3;
  /** Set by `w.npc.trackNpc`; `null` means off. A live reference — not a snapshot. */
  targetOverride: null | { x: number; y: number; z: number };
  /** Set by `w.npc.trackNpc`; lets `"enter-room"` know which npc's room-transitions should refresh the tracked light's room-poly clip */
  trackedNpcKey: null | string;
  /** Tracked-light radius, set once by `w.npc.trackNpc` */
  radius: number;
  /** Encoded (gmId, doorId) of each door bordering the tracked room, for per-frame live open-ratio reads (see `onCameraChange`) — same order as last passed to `trackedLight.setTrackedRoomDoors` */
  doorInstanceIds: number[];
  /** Door whose "inside" sensor zone `checkTrackedDoorCrossing` is currently pinned to, else `null` */
  doorCrossGdKey: null | Geomorph.GmDoorKey;
  /** Last known side of `doorCrossGdKey` (index into its `connector.roomIds`), else `null` */
  doorCrossSign: 0 | 1 | null;
  /** Room last passed to `switchTrackedNpcRoom`/set by `w.npc.trackNpc` — lets a room switch look
   * back at the room just left (see `nearbyDoorMergeDist`), else `null` */
  currentGmRoomId: null | Geomorph.GmRoomId;
};

function PostProcessing() {
  const w = useContext(WorldContext);
  useEffect(() => w.view.setupPostProcessing(), []);
  return null;
}

const tmpVect = new Vect();

export type Picked = {
  instanceId: number;
} & (
  | { type: "floor"; floor: true; gmId: number; gmKey: string }
  | { type: "ceiling"; ceiling: true; gmId: number; gmKey: string }
  | ({ type: "door"; door: true } & ReturnType<import("./Doors").State["decodeInstanceId"]>)
  | ({ type: "wall"; wall: true } & ReturnType<import("./Walls").State["decodeInstanceId"]>)
  | ({ type: "obstacle"; obstacle: true } & ReturnType<import("./Obstacles").State["decodeInstanceId"]>)
  // static and runtime decor have same decode format
  | ({ type: "decor"; decor: true } & ReturnType<import("./Decor").State["decodeStaticInstanceId"]>)
  | ({ type: "debugPoint"; debugPoint: true } & ReturnType<import("./Debug").State["decodeDebugPointInstanceId"]>)
  // we require spawn inside room but map might change
  | ({ type: "npc"; npcKey: string } & Partial<Geomorph.GmRoomId>)
);
