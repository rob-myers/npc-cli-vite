import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, ExhaustiveError, useStateRef } from "@npc-cli/util";
import { Vect } from "@npc-cli/util/geom";
import { getRelativePointer, isRMB } from "@npc-cli/util/legacy/dom";
import {
  mapValues,
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
import useMeasure from "react-use-measure";
import { colorBleeding } from "three/addons/tsl/display/CRT.js";
import { Fn, float, instanceIndex, mix, output, pass, select, uniform, vec3, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { WorldTheme } from "../assets.schema";
import {
  ambientIntensityKey,
  cameraModeStorageKey,
  cameraPositionStorageKey,
  defaultCameraModeDesktop,
  defaultCameraModeMobile,
  defaultCardinalDirectionsDesktop,
  defaultCardinalDirectionsMobile,
  defaultDesktopFov,
  defaultMobileFov,
  defaultRoomLightIntensity,
  defaultVignette,
  fovStorageKey,
  numCardinalDirectionsKey,
  postProcessingEnabledKey,
  roomLightEditingEnabledKey,
  roomLightIntensityKey,
  roomLightingEnabledKey,
  roomLitStorageKeyPrefix,
  wallHeight,
} from "../const";
import type { CameraControls as BaseCameraControls } from "../service/camera-controls";
import { createDynamicLightPostprocess, type DynamicLightPostprocess } from "../service/dynamic-light";
import { computeIntersectionNormal, getTempInstanceMesh } from "../service/geometry";
import * as persisted from "../service/get-persisted";
import { decodePick } from "../service/pick";
import { createRoomLightPostprocess, type RoomLightPostprocess } from "../service/room-light-postprocess";
import type { SelectAnyType } from "../service/texture";
import { applyVignette } from "../service/vignette";
import { CameraControls, type CameraModeType } from "./CameraControls";
import NpcBubbles from "./NpcBubbles";
import { WorldContext } from "./world-context";

export function WorldView(props: React.PropsWithChildren<{ className?: string }>) {
  const { uiStoreApi } = useContext(UiContext);
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ambientIntensity: persisted.getAmbientIntensity(),
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      canvas: null as any,
      cameraDirections:
        tryLocalStorageGetParsed<number>(numCardinalDirectionsKey) ??
        (w.touchDevice ? defaultCardinalDirectionsMobile : defaultCardinalDirectionsDesktop),
      cameraMode:
        tryLocalStorageGet<CameraModeType>(cameraModeStorageKey) ??
        (w.touchDevice ? defaultCameraModeMobile : defaultCameraModeDesktop),
      clickIds: [],
      controls: null as any,
      ctrlOpts: {
        minAzimuthAngle: -Infinity,
        maxAzimuthAngle: +Infinity,
        minPolarAngle: Math.PI / 64,
        maxPolarAngle: Math.PI / 2 - Math.PI / 8,
        minDistance: w.touchDevice ? 8 : 14,
        maxDistance: 20,
        extraZoom: 2,
        panSpeed: 2,
        rotateSpeed: 0.5,
        zoomSpeed: 0.3,
      },
      dynamicLight: createDynamicLightPostprocess({
        bottomHeight: 0,
        topHeight: wallHeight - 0.01, // avoid ceiling aliasing
        marchSteps: 96,
      }),
      dynamicLightTarget: null,
      fov: tryLocalStorageGetParsed<number>(fovStorageKey) ?? (w.touchDevice ? defaultMobileFov : defaultDesktopFov),
      initial: getInitialCamera(w.touchDevice),
      lookAtAnimId: 0,
      ambientAnimId: 0,
      lightTweenId: 0,
      lastPointer: {
        epochMs: 0,
        longPressTimer: 0,
        longPress: false,
        move: new Vect(),
        down: new Vect(),
        rightPress: false,
      },
      objectPick: uniform(0),
      objectPickScale: 0.5, // don't pick walls by default
      pickRT: new THREE.RenderTarget(1, 1, { format: THREE.RGBAFormat }),
      postProcessing: tryLocalStorageGetParsed<boolean>(postProcessingEnabledKey) ?? true,
      // each is 0..1, driving a `mix` so 0 is exactly identity
      fx: mapValues(fxDefaults, (value, key) =>
        uniform(tryLocalStorageGetParsed<Record<string, number>>(fxKey)?.[key] ?? value),
      ),
      raycaster: new THREE.Raycaster(),
      roomLight: createRoomLightPostprocess({
        roomLightingEnabled: tryLocalStorageGetParsed<boolean>(roomLightingEnabledKey) ?? true,
        bottomHeight: 0,
        topHeight: wallHeight - 0.01,
      }),
      roomLightEditingEnabled: tryLocalStorageGetParsed<boolean>(roomLightEditingEnabledKey) ?? true,
      roomLightIntensity: uniform(tryLocalStorageGetParsed<number>(roomLightIntensityKey) ?? defaultRoomLightIntensity),
      unlitScale: uniform(persisted.getAmbientIntensity()),

      async createRenderer(props) {
        const canvas = props.canvas as HTMLCanvasElement;

        // three seeds its *logical* size from `canvas.width` (see `CanvasTarget`),
        // which otherwise defaults to 300x150. It must not be scaled by the pixel
        // ratio, which `setPixelRatio` applies below i.e. `canvas.width = w * ratio`.
        canvas.width = state.bounds.width;
        canvas.height = state.bounds.height;

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

        // before `init`, so attachments are created at the drawing buffer size,
        // rather than at 1x whilst the canvas is already scaled. Matches the `dpr`
        // given to `<Canvas>`, so r3f's own `setPixelRatio` is a no-op.
        renderer.setPixelRatio(getPixelRatio());

        await renderer.init();
        return renderer;
      },
      forceUpdate(delta = 0) {
        w.npc?.onTick(delta);
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
      onCameraChange(_spherical: THREE.Spherical, _target: THREE.Vector3) {
        const camera = state.controls?.object ?? w.r3f.camera;
        state.roomLight.update(camera);
        state.dynamicLight.update(camera);
      },
      onCameraEnd() {
        const lastCameraReading: State["initial"] = {
          azimuthal: state.controls.spherical.theta,
          polar: state.controls.spherical.phi,
          position: { x: state.controls.target.x, y: state.controls.spherical.radius, z: state.controls.target.z },
        };
        tryLocalStorageSet(cameraPositionStorageKey, JSON.stringify(lastCameraReading));
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
      resetAllRooms() {
        state.roomLight.resetAllRooms();
        tryLocalStorageSet(`${roomLitStorageKeyPrefix}:${w.mapKey}`, JSON.stringify([]));
        state.setPostProcessingEnabled(true);
      },
      setupDom() {
        const ro = new ResizeObserver(([entry]) => {
          // only trigger when visible
          entry.contentRect.width && state.onResize();
        });
        ro.observe(w.rootEl);

        const { onKeyDown } = state;
        w.rootEl.addEventListener("keydown", onKeyDown);

        return () => {
          ro.disconnect();
          w.rootEl?.removeEventListener("keydown", onKeyDown);
        };
      },
      setupLights() {
        state.roomLight.syncGms(w.gms, w.gmsData);
        const savedLitRooms = tryLocalStorageGetParsed<[number, number][]>(`${roomLitStorageKeyPrefix}:${w.mapKey}`);
        if (savedLitRooms) {
          state.roomLight.setRoomLitPairs(savedLitRooms);
        }
        if (state.dynamicLightTarget !== null && w.npc.npc[state.dynamicLightTarget.npcKey]) {
          w.npc.trackNpc(state.dynamicLightTarget.npcKey);
        }
      },
      setAmbientIntensity(next, persist = true) {
        state.ambientIntensity = next;
        state.unlitScale.value = next;
        state.setPostProcessingEnabled(true);
        persist && tryLocalStorageSet(ambientIntensityKey, String(next));
        state.forceUpdate();
      },
      setCameraMode(cameraMode) {
        tryLocalStorageSet(cameraModeStorageKey, cameraMode);
        state.set({ cameraMode });
        w.update(); // e.g. WorldMenu's "camera: {mode}" label reads this
      },
      async lookAt(groundPoint, opts = {}) {
        const { controls } = state;
        if (controls === null) {
          return;
        }

        cancelAnimationFrame(state.lookAtAnimId);
        const from = controls.target.clone();
        const to = new THREE.Vector3(groundPoint.x, 0, groundPoint.y);

        /** Keeps the current zoom/orientation, only moving the orbit target */
        const applyTarget = (alpha: number) => {
          controls.target.copy(from).lerp(to, alpha);
          const delta = new THREE.Vector3().setFromSphericalCoords(
            controls.spherical.radius,
            controls.spherical.phi,
            controls.spherical.theta,
          );
          controls.object.position.copy(controls.target).add(delta);
          controls.update();
          w.r3f?.invalidate();
        };

        if (opts.animate !== true) {
          return applyTarget(1);
        }

        // further pans take longer, so the apparent speed stays similar
        const durationMs = Math.min(lookAtMaxMs, lookAtMinMs + from.distanceTo(to) * lookAtMsPerUnit);
        const startEpochMs = performance.now();

        await new Promise<void>((resolve) => {
          const step = () => {
            if (controls.pointers.length > 0) {
              return resolve(); // interacting: leave the camera where they put it
            }
            const ratio = Math.min(1, (performance.now() - startEpochMs) / durationMs);
            // smootherstep: unlike smoothstep its acceleration is zero at both ends too
            applyTarget(ratio * ratio * ratio * (ratio * (ratio * 6 - 15) + 10));
            if (ratio < 1) {
              state.lookAtAnimId = requestAnimationFrame(step);
            } else {
              resolve();
            }
          };
          step();
        });
      },
      fadeAmbient(next, durationMs = ambientFadeDurationMs) {
        cancelAnimationFrame(state.ambientAnimId);
        const from = state.ambientIntensity;

        const startEpochMs = performance.now();
        const step = () => {
          const ratio = Math.min(1, (performance.now() - startEpochMs) / durationMs);
          if (ratio < 1) {
            state.setAmbientIntensity(from + (next - from) * ratio, false);
            state.ambientAnimId = requestAnimationFrame(step);
          } else {
            state.setAmbientIntensity(next);
          }
        };
        step();
      },
      resetCamera() {
        const initial = defaultInitialCamera(w.touchDevice);
        state.initial = initial;
        tryLocalStorageSet(cameraPositionStorageKey, JSON.stringify(initial));
        if (state.controls) {
          state.controls.target.set(initial.position.x, 0, initial.position.z);
          const delta = new THREE.Vector3().setFromSphericalCoords(
            initial.position.y,
            initial.polar,
            initial.azimuthal,
          );
          state.controls.object.position.copy(state.controls.target).add(delta);
          state.controls.update();
          w.r3f?.invalidate();
        }
      },
      setDynamicLightIntensity(next) {
        state.dynamicLight.setIntensity(next);
        state.setPostProcessingEnabled(true);
        state.forceUpdate();
      },
      setDynamicLightRadius(next) {
        state.dynamicLight.setRadius(next);
        state.setPostProcessingEnabled(true);
        state.forceUpdate();
      },
      setRoomLightingEnabled(next = state.roomLight.roomLightingEnabled.value === 0) {
        state.roomLight.setRoomLightingEnabled(next);
        state.roomLightEditingEnabled = next;
        tryLocalStorageSet(roomLightingEnabledKey, String(next));
        state.setPostProcessingEnabled(true);
      },
      setRoomLightIntensity(next) {
        state.roomLightIntensity.value = next;
        tryLocalStorageSet(roomLightIntensityKey, String(next));
        state.setPostProcessingEnabled(true);
        state.forceUpdate();
      },
      setNumCardinalDirections(n) {
        tryLocalStorageSet(numCardinalDirectionsKey, String(n));
        state.set({ cameraDirections: n });
        w.update();
      },
      setFx(key, next = state.fx[key].value === 0 ? 1 : 0) {
        state.fx[key].value = next;
        tryLocalStorageSet(fxKey, JSON.stringify(mapValues(state.fx, (u) => u.value)));
        state.setPostProcessingEnabled(true);
        state.forceUpdate();
      },
      setPostProcessingEnabled(next = !state.postProcessing) {
        state.postProcessing = next;
        tryLocalStorageSet(postProcessingEnabledKey, String(next));
        state.forceUpdate();
      },
      setRoomLit(groundPoint, next) {
        const gmRoomId = w.e.findRoomContaining(groundPoint, true);
        if (!gmRoomId) {
          return;
        }

        const { gmId, roomId } = gmRoomId;
        const nextLit = next ?? !state.roomLight.isRoomLit(gmId, roomId);
        state.roomLight.setRoomLit(gmId, roomId, nextLit);

        tryLocalStorageSet(`${roomLitStorageKeyPrefix}:${w.mapKey}`, JSON.stringify(state.roomLight.getLitRoomPairs()));
        state.setPostProcessingEnabled(true);
        state.forceUpdate();
      },
      setupPostProcessing() {
        const { gl, scene, camera } = w.r3f;
        const scenePass = pass(scene, camera);
        const sceneColor = scenePass.getTextureNode("output");
        // raw logarithmic depth — litAmount() (room + tracked) does its own log-depth inversion
        const sceneDepth = scenePass.getTextureNode("depth");

        const brightColor = colorBleeding(sceneColor, uniform(0.0025)).mul(vec3(1), sceneColor.a);

        const litEffect = Fn(() => {
          const dynamicLitAmount = state.dynamicLight.litAmount(sceneDepth.r).mul(state.dynamicLight.intensity);

          const isBright = state.roomLight
            .litAmount(sceneDepth.r)
            // lit rooms start darkening when intensity low
            .mul(select(state.unlitScale.lessThan(0.25), state.unlitScale.div(0.25), 1))
            .mul(state.roomLightIntensity)
            .max(dynamicLitAmount)
            .toVar(); // reused by the vignette below

          const color = mix(sceneColor.rgb.mul(state.unlitScale), brightColor, isBright).toVar();

          // cheap toggleable effects, each a no-op whilst its uniform is 0
          color.assign(applyVignette(color, state.fx.vignette, isBright));

          return color;
        })();

        const pipeline = new THREE.RenderPipeline(gl);
        pipeline.outputNode = vec4(litEffect, sceneColor.a);

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
      toggleRoomLightEditing() {
        state.roomLightEditingEnabled = !state.roomLightEditingEnabled;
        tryLocalStorageSet(roomLightEditingEnabledKey, String(state.roomLightEditingEnabled));
        w.update();
      },
      updateDynamicLight(rawTarget, opts = {}) {
        const { displayCenter } = state.dynamicLight;
        const target = tmpVector3.set(rawTarget.x, rawTarget.y, rawTarget.z);

        if (opts.snap === true) {
          cancelAnimationFrame(state.lightTweenId);
          state.lightTweenId = 0;
        }

        if (state.lightTweenId === 0) {
          if (opts.snap !== true && displayCenter.distanceTo(target) > dynamicLightTweenFrom) {
            state.tweenDynamicLight(); // a teleport e.g. fadeSpawn
          } else {
            displayCenter.copy(target);
          }
        }

        state.dynamicLight.setTracked({ x: displayCenter.x, z: displayCenter.z });
        state.dynamicLight.setActiveGmDoorRatios(
          state.dynamicLight.activeGmDoorInstanceIds.map((id) => w.door.openRatioArray[id]),
        );
      },
      tweenDynamicLight() {
        cancelAnimationFrame(state.lightTweenId);
        const { displayCenter } = state.dynamicLight;
        let lastEpochMs = performance.now();

        // self-driving, so the light also catches up whilst the world is paused
        const step = () => {
          const position = state.dynamicLightTarget?.position;
          if (position === undefined) {
            state.lightTweenId = 0;
            return;
          }

          const nowEpochMs = performance.now();
          const deltaSecs = (nowEpochMs - lastEpochMs) / 1000;
          lastEpochMs = nowEpochMs;

          const target = tmpVector3.set(position.x, position.y, position.z);
          displayCenter.lerp(target, 1 - Math.exp(-dynamicLightTweenRate * deltaSecs));

          if (displayCenter.distanceTo(target) > dynamicLightTweenUntil) {
            state.lightTweenId = requestAnimationFrame(step);
          } else {
            displayCenter.copy(target);
            state.lightTweenId = 0;
          }

          state.dynamicLight.setTracked({ x: displayCenter.x, z: displayCenter.z });
          w.r3f?.invalidate();
        };

        state.lightTweenId = requestAnimationFrame(step);
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
    { reset: { ctrlOpts: true, initial: false, roomLight: true, dynamicLight: true } },
  );

  w.view = state;

  useEffect(() => w.rootEl && state.setupDom(), [w.rootEl]);

  useEffect(() => void state.setupLights(), [w.hash, w.gmsData, w.mapKey]);

  // useEffect(
  //   () => void (state.dynamicLightTarget !== null && w.npc.trackNpc(state.dynamicLightTarget.npcKey)),
  //   [state.dynamicLight],
  // );

  const [ref, bounds] = useMeasure();
  state.bounds = bounds;

  return (
    <div className="size-full" ref={ref}>
      <Canvas
        className={props.className}
        style={{
          filter: `brightness(${w.brightness})`,
          backgroundColor: getBackgroundColor(w.getTheme(), state.ambientIntensity),
        }}
        ref={state.ref("canvas")}
        frameloop={state.syncRenderMode()}
        gl={state.createRenderer}
        onCreated={state.onCreated}
        onPointerDown={state.onPointerDown}
        onPointerLeave={state.onPointerLeave}
        onPointerMove={state.onPointerMove}
        onPointerUp={state.onPointerUp}
        dpr={getPixelRatio()}
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
          numCardinalDirections={state.cameraDirections}
          domElement={state.canvas}
          initialAzimuthal={state.initial.azimuthal}
          initialPolar={state.initial.polar}
          initialPosition={state.initial.position}
          minPanDistance={w.touchDevice ? 0.05 : 0}
          onFrame={state.onCameraChange}
          onEnd={state.onCameraEnd}
          {...state.ctrlOpts}
        />

        <NpcBubbles />

        {state.postProcessing && <PostProcessing />}

        {props.children}
      </Canvas>

      <AnimatePresence>
        {w.disabled && (
          <motion.div
            className="absolute inset-x-0 top-[20%] flex justify-center pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="px-4 py-1.5 rounded-full bg-white/10 text-white/80 backdrop-blur-[2px] border border-white/40 text-xs font-mono tracking-[0.3em] uppercase select-none">
              paused
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export type State = {
  bounds: Geom.RectJson;
  cameraMode: CameraModeType;
  cameraDirections: number;
  canvas: HTMLCanvasElement;
  clickIds: { id: string; blocking: boolean }[];
  controls: BaseCameraControls;
  ctrlOpts: MapControlsProps & { extraZoom?: number };
  initial: { azimuthal: number; polar: number; position: { x: number; y: number; z: number } };
  /** Latest camera reading, updated every frame by `onCameraChange` — persisted by `onCameraEnd` */
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
  /** Cheap post effects, each `0` (off) or `1` (on) */
  fx: Record<FxKey, ReturnType<typeof uniform<"float", number>>>;
  /** Toggles (or sets) one of `fx` */
  setFx(key: FxKey, next?: number): void;
  roomLight: RoomLightPostprocess;
  /** Toggled via long-press on WorldMenu's lights icon; gates long-press room toggling in `use-world-events.ts` */
  roomLightEditingEnabled: boolean;
  /** Persisted, user-controlled brightness of a lit room (0..1) — see `defaultRoomLightIntensity` */
  roomLightIntensity: THREE.UniformNode<"float", number>;
  unlitScale: THREE.UniformNode<"float", number>;
  /** Persisted magnitude backing `dimWorldColor` — see `defaultAmbientIntensity` */
  ambientIntensity: number;
  dynamicLight: DynamicLightPostprocess;
  /** Set by `w.npc.trackNpc`; `position` is a live reference (e.g. `npc.position`), not a snapshot. `null` means off. Lives outside `dynamicLight` so it survives that object's HMR reset (see the re-hydration effect in `WorldView`). */
  dynamicLightTarget: null | { npcKey: string; position: { x: number; y: number; z: number } };
  /** Non-zero whilst the tracked light is catching up with a teleported target */
  lightTweenId: number;
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
  /** Persists `lastCameraReading` — wired to `<CameraControls onEnd>`, fires on real interaction end */
  onCameraEnd(): void;
  /** Advances `dynamicLight.displayCenter` from a live target — called every tick from `World`'s `onTick` while `dynamicLightTarget` is set (see `w.npc.trackNpc`) */
  updateDynamicLight(rawTarget: { x: number; y: number; z: number }, opts?: { snap?: boolean }): void;
  /** Eases `dynamicLight.displayCenter` onto the tracked target, e.g. after a teleport */
  tweenDynamicLight(): void;
  toggleRoomLightEditing(): void;
  /** Toggles `roomLight.roomLightingEnabled` — persisted to localStorage */
  setRoomLightingEnabled(next?: boolean): void;
  /** Sets the persisted room-light intensity (0..1) — see `defaultRoomLightIntensity` */
  setRoomLightIntensity(next: number): void;
  /** Sets the dynamic light's radius (persisted) — updates the live uniform if tracking is active */
  setDynamicLightRadius(next: number): void;
  /** Sets the dynamic light's brightness multiplier (0..1, persisted) */
  setDynamicLightIntensity(next: number): void;
  /** Sets the world's ambient tint magnitude (persisted) — see `defaultAmbientIntensity` */
  setAmbientIntensity(next: number, persist?: boolean): void;
  /** Toggles whether `gmRoomId`'s room is lit, unless lighting isn't permitted there (see `roomLightingDisallowed`) */
  setRoomLit(groundCenter: Geom.VectJson, next?: boolean): void;
  /** Clears every lit room */
  resetAllRooms(): void;
  /** Debounced resize + key events */
  setupDom(): () => void;
  setupLights(): void;
  setCameraMode(cameraMode: CameraModeType): void;
  /** What two fingers do; one finger always pans */
  /** Restores `initial` to its default and immediately re-applies it to the live camera/controls */
  /** Moves the camera's orbit target onto `groundPoint`, preserving zoom/orientation. Resolves on arrival. */
  lookAt(groundPoint: Geom.VectJson, opts?: { animate?: boolean }): Promise<void>;
  /** Non-zero whilst `lookAt` is animating */
  lookAtAnimId: number;
  /** Animates `ambientIntensity`, persisting the final value */
  fadeAmbient(next: number, durationMs?: number): void;
  /** Non-zero whilst `fadeAmbient` is animating */
  ambientAnimId: number;
  resetCamera(): void;
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

function getBackgroundColor(theme: WorldTheme, ambientIntensity: number) {
  const color = theme.background.match(/^bg-\[(.+)\]$/)?.[1];
  return color === undefined ? undefined : `color-mix(in srgb-linear, ${color} ${ambientIntensity * 100}%, #000)`;
}

/** Mirrors r3f's default `dpr={[1, 2]}` i.e. `calculateDpr` */
function getPixelRatio() {
  return Math.min(Math.max(1, window.devicePixelRatio), 2);
}

/** An animated `lookAt` lasts `lookAtMinMs + distance * lookAtMsPerUnit`, capped */
const lookAtMinMs = 700;
const lookAtMsPerUnit = 60;
const lookAtMaxMs = 2500;
/** A tracked-light jump beyond this (world units) tweens rather than snaps */
const dynamicLightTweenFrom = 1;
/** Tween ends once this close (world units) to the target */
const dynamicLightTweenUntil = 0.05;
/** Exponential approach rate of the tween, per second */
const dynamicLightTweenRate = 6;
/** Default duration of `fadeAmbient` */
const ambientFadeDurationMs = 1000;

/** The intro pans from here to the player, via `w.player.panToPlayer` */
function getInitialCamera(touchDevice: boolean): State["initial"] {
  return tryLocalStorageGetParsed<State["initial"]>(cameraPositionStorageKey) ?? defaultInitialCamera(touchDevice);
}

function defaultInitialCamera(touchDevice: boolean): State["initial"] {
  return {
    azimuthal: touchDevice ? 0 : Math.PI / 4,
    polar: Math.PI / 4,
    position: { x: 4, y: touchDevice ? 10 : 16, z: 4 },
  };
}

function PostProcessing() {
  const w = useContext(WorldContext);
  useEffect(() => w.view.setupPostProcessing(), []);
  return null;
}

export type FxKey = keyof typeof fxDefaults;

/** Add a key here and a branch in `setupPostProcessing`, and it shows up under "debug" */
const fxDefaults = { vignette: defaultVignette };
const fxKey = "world-fx";

const tmpVect = new Vect();
const tmpVector3 = new THREE.Vector3();

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
