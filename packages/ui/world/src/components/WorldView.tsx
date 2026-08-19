import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, ExhaustiveError, Spinner, useStateRef } from "@npc-cli/util";
import { Rect, Vect } from "@npc-cli/util/geom";
import { getRelativePointer, isRMB } from "@npc-cli/util/legacy/dom";
import { mapValues, pause, testNever } from "@npc-cli/util/legacy/generic";
import { drawPolygons } from "@npc-cli/util/service/canvas";
import { type MapControlsProps, PerspectiveCamera, Stats } from "@react-three/drei";
import { Canvas, type RootState } from "@react-three/fiber";
import type { DefaultGLProps } from "@react-three/fiber/dist/declarations/src/core/renderer";
import debounce from "debounce";
import { AnimatePresence, motion } from "motion/react";
import { useContext, useEffect } from "react";
import useMeasure from "react-use-measure";
import { colorBleeding } from "three/addons/tsl/display/CRT.js";
import { Fn, float, instanceIndex, mix, mrt, output, pass, select, uniform, vec3, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import {
  cameraFov,
  cameraRefAspect,
  defaultCameraModeDesktop,
  defaultCameraModeMobile,
  defaultCardinalDirectionsDesktop,
  defaultCardinalDirectionsMobile,
  defaultVignette,
  lightTileSize,
  maxDynamicLightRadius,
  rotateSpeedDesktop,
  rotateSpeedMobile,
  wallHeight,
  zoomSpeedDesktop,
  zoomSpeedMobile,
} from "../const";
import type { CameraControls as BaseCameraControls } from "../service/camera-controls";
import { createDynamicLightPostprocess, type DynamicLightPostprocess } from "../service/dynamic-light";
import { computeIntersectionNormal, getTempInstanceMesh } from "../service/geometry";
import { applyNpcOutline } from "../service/npc-outline";
import { decodePick } from "../service/pick";
import { createRoomLightPostprocess, type RoomLightPostprocess } from "../service/room-light-postprocess";
import { getWorldMapStore, getWorldStore, type PersistedCamera } from "../service/storage";
import type { SelectAnyType } from "../service/texture";
import { applyVignette } from "../service/vignette";
import { CameraControls, type CameraModeType } from "./CameraControls";
import NpcBubbles from "./NpcBubbles";
import { WorldContext } from "./world-context";

export function WorldView(props: React.PropsWithChildren<{ className?: string }>) {
  const { uiStoreApi } = useContext(UiContext);
  const w = useContext(WorldContext);

  /** Every setting we persist — see `service/storage.ts`. Memoised per `worldKey` */
  const store = getWorldStore(w.key);
  const saved = store.read();

  const state = useStateRef(
    (): State => ({
      ambientIntensity: saved.ambientIntensity,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      canvas: null as any,
      cameraDirections:
        saved.cameraDirections ?? (w.touchDevice ? defaultCardinalDirectionsMobile : defaultCardinalDirectionsDesktop),
      cameraMode: saved.cameraMode ?? (w.touchDevice ? defaultCameraModeMobile : defaultCameraModeDesktop),
      clickIds: [],
      controls: null as any,
      ctrlOpts: {
        minAzimuthAngle: -Infinity,
        maxAzimuthAngle: +Infinity,
        minPolarAngle: Math.PI / 64,
        maxPolarAngle: Math.PI / 2 - Math.PI / 8,
        minDistance: 15,
        maxDistance: 15,
        extraZoom: 3,
        panSpeed: 2,
        // touch gestures have far less travel than a mouse drag/wheel, so they need more per-pixel
        rotateSpeed: w.touchDevice ? rotateSpeedMobile : rotateSpeedDesktop,
        zoomSpeed: w.touchDevice ? zoomSpeedMobile : zoomSpeedDesktop,
      },
      dynamicLight: createDynamicLightPostprocess({
        bottomHeight: 0,
        topHeight: wallHeight - 0.01, // avoid ceiling aliasing
        // enough that `marchStepSize` — (maxDynamicLightRadius + falloff) / this — stays well under
        // `doorHalfDepth`, else the march steps straight over a closed door and lights the far side
        marchSteps: 136,
        radius: saved.dynamicLightRadius,
        intensity: saved.dynamicLightIntensity,
      }),
      dynamicLightTarget: null,
      initial: saved.cameraInitial ?? defaultInitialCamera(w.touchDevice),
      lookAtAnimId: 0,
      stripesFaded: false,
      stripeTimer: 0,
      prevVignette: null,
      vignetteAnimId: 0,
      shiftDownMs: 0,
      ambientAnimId: 0,
      light: {
        tweenId: 0,
        ratios: new Float32Array(0),
        tileDoors: [],
        doorsByTile: new Map(),
      },
      lastPointer: {
        epochMs: 0,
        longPressTimer: 0,
        longPress: false,
        move: new Vect(),
        down: new Vect(),
        rightPress: false,
      },
      foldNode: uniform(1),
      freezeEl: null as any,
      frozen: false,
      objectPick: uniform(0),
      objectPickScale: 0.5, // don't pick walls by default
      pickRT: createPickRT(1),
      npcMaskMrt: null,
      postProcessing: saved.postProcessing,
      // each is 0..1, driving a `mix` so 0 is exactly identity
      fx: mapValues(fxDefaults, (value, key) => uniform(saved.fx[key] ?? value)),
      raycaster: new THREE.Raycaster(),
      roomLight: createRoomLightPostprocess({
        roomLightingEnabled: saved.roomLighting,
        bottomHeight: 0,
        topHeight: wallHeight - 0.01,
      }),
      roomLightEditingEnabled: saved.roomLightEditing,
      prevRoomLightEditing: null,
      roomLightIntensity: uniform(saved.roomLightIntensity),
      unlitScale: uniform(saved.ambientIntensity),

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
        state.fadeStripes();
      },
      fadeStripes() {
        // a timer rather than the controls' `end` event, so a programmatic pan — the intro, say —
        // brings them back too. This runs per frame whilst the camera moves, hence the guard
        if (state.stripesFaded === false) {
          state.stripesFaded = true;
          w.rootEl?.style.setProperty("--world-stripe", `${movingStripeAlpha}`);
        }
        clearTimeout(state.stripeTimer);
        state.stripeTimer = window.setTimeout(() => {
          state.stripesFaded = false;
          w.rootEl?.style.setProperty("--world-stripe", "1");
        }, stripeRestoreMs);
      },
      onCameraEnd() {
        const cameraInitial: PersistedCamera = {
          azimuthal: state.controls.spherical.theta,
          polar: state.controls.spherical.phi,
          position: { x: state.controls.target.x, y: state.controls.spherical.radius, z: state.controls.target.z },
        };
        store.patch({ cameraInitial });
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
        if (e.key === "Shift" && e.repeat === false) {
          state.shiftDownMs = performance.now();
        }
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (e.key === "Escape") {
          uiStoreApi.setUiMeta(w.id, (draft) => (draft.disabled = true));
        } else if (e.key === "Enter") {
          uiStoreApi.setUiMeta(w.id, (draft) => (draft.disabled = false));
        }
      },
      onKeyUp(e) {
        // a tap toggles the extra zoom lock, where holding it down does nothing — as the
        // button does on touch. `shiftDownMs` is when it went down, `0` once spent
        if (e.key === "Shift") {
          const tapped = state.shiftDownMs > 0 && performance.now() - state.shiftDownMs < shiftTapMs;
          state.shiftDownMs = 0;
          if (tapped === true) state.controls?.toggleExtraZoomLock();
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
        if (w.settledMapKey !== w.mapKey) {
          return;
        }
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
        // the npc material declares an extra output whilst outlining, so this pass needs the same
        // mrt (and `pickRT` the matching attachment count) or its pipeline won't validate
        renderer.setMRT(state.npcMaskMrt);
        renderer.setRenderTarget(rt);
        renderer.render(scene, rtCamera);
        state.objectPick.value = 0;
        renderer.setMRT(null);
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
        getWorldMapStore(w.key, w.mapKey).patch({ roomLit: [] });
        state.setPostProcessingEnabled(true);
      },
      syncPickRT() {
        // `RenderTarget` attachments must match what the materials output — see `pickObject`
        const count = state.npcMaskMrt === null ? 1 : 2;
        if (state.pickRT.textures.length !== count) {
          state.pickRT.dispose();
          state.pickRT = createPickRT(count);
        }
      },
      setupDom() {
        const ro = new ResizeObserver(([entry]) => {
          // only trigger when visible
          entry.contentRect.width && state.onResize();
        });
        ro.observe(w.rootEl);

        const { onKeyDown, onKeyUp } = state;
        w.rootEl.addEventListener("keydown", onKeyDown);
        // on `window`, else a release after focus moved elsewhere never reaches us and the
        // next release would read as a very long tap
        window.addEventListener("keyup", onKeyUp);

        const onExtraZoomChange = (e: Event) => {
          const { locked } = (e as CustomEvent<{ locked: boolean }>).detail;
          state.setVignetteFocus(locked);
          state.setRoomLightEditingWhilstLocked(locked);
          w.menu?.update(); // the extra-zoom button reads it too
        };
        w.rootEl.addEventListener("extrazoomchange", onExtraZoomChange);

        return () => {
          ro.disconnect();
          w.rootEl?.removeEventListener("keydown", onKeyDown);
          window.removeEventListener("keyup", onKeyUp);
          w.rootEl?.removeEventListener("extrazoomchange", onExtraZoomChange);
        };
      },
      setupLights() {
        state.roomLight.syncGms(w.gms, w.gmsData);
        state.roomLight.setRoomLitPairs(getWorldMapStore(w.key, w.mapKey).read().roomLit);
        // re-establishing a target we already had, so an npc a map edit has left outside every
        // room is no error: `trackNpc` would throw, taking the room lights above down with it,
        // where waiting for the geometry to settle costs only this light and only for a pass
        const npc = state.dynamicLightTarget === null ? undefined : w.n[state.dynamicLightTarget.npcKey];
        if (npc !== undefined && w.e.findRoomContaining(npc.position, true) !== null) {
          w.npc.trackNpc(npc.key);
        }
      },
      setAmbientIntensity(next, persist = true) {
        state.ambientIntensity = next;
        state.unlitScale.value = next;
        state.setPostProcessingEnabled(true);
        persist && store.patch({ ambientIntensity: next });
        state.forceUpdate();
      },
      setCameraMode(cameraMode) {
        store.patch({ cameraMode });
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
        const to = new THREE.Vector3(groundPoint.x, opts.height ?? 0, groundPoint.y);

        // `update` would clamp it anyway, but then `fromRadius` and the tween would disagree
        const fromRadius = controls.spherical.radius;
        const toRadius =
          opts.radius === undefined
            ? fromRadius
            : THREE.MathUtils.clamp(opts.radius, controls.minDistance, controls.maxDistance);

        /**
         * Keeps the current orientation, moving the orbit target and (optionally) the zoom.
         * The camera must be carried along explicitly: `update` derives `spherical` from
         * `position - target`, so moving the target alone would swing the camera instead.
         * We don't call `update` ourselves — `CameraControls` does so from a `useFrame` just
         * before the render, and a second call would double its per-call damping.
         */
        const applyTarget = (alpha: number) => {
          controls.target.copy(from).lerp(to, alpha);
          // live `phi`/`theta`, so e.g. cardinal snapping still applies mid-pan
          const radius = fromRadius + (toRadius - fromRadius) * alpha;
          tmpLookAtOffset.setFromSphericalCoords(radius, controls.spherical.phi, controls.spherical.theta);
          controls.object.position.copy(controls.target).add(tmpLookAtOffset);
          w.r3f?.invalidate();
        };

        if (opts.animate !== true) {
          applyTarget(1);
          controls.update(); // no frame to wait for
          return;
        }

        // a leftover gesture would otherwise keep decaying underneath the pan
        controls.u.panOffset.set(0, 0, 0);
        controls.sphericalDelta.set(0, 0, 0);

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
      dimBackground(darken, durationMs = bgDimMs) {
        w.rootEl?.style.setProperty("--world-dim-duration", `${durationMs}ms`);
        w.rootEl?.style.setProperty("--world-dim", `${darken ? 1 : 0}`);
        return pause(durationMs);
      },
      freezeCanvas() {
        // the last presented image is still there to be read, WebGPU having no
        // `preserveDrawingBuffer` caveat, so long as nothing has rendered since
        const { canvas, freezeEl } = state;
        freezeEl.width = canvas.width;
        freezeEl.height = canvas.height;
        freezeEl.getContext("2d")?.drawImage(canvas, 0, 0);
        state.frozen = true;
        w.rootEl?.style.setProperty("--world-freeze-duration", "0ms");
        // it swallows the pointer whilst up, so the camera cannot be driven around a world
        // that is not the one on screen
        w.rootEl?.style.setProperty("--world-freeze-events", "auto");
        w.rootEl?.style.setProperty("--world-freeze", "1");
      },
      unfreezeCanvas(durationMs = freezeFadeMs) {
        if (state.frozen === false) return Promise.resolve();
        state.frozen = false;
        w.rootEl?.style.setProperty("--world-freeze-duration", `${durationMs}ms`);
        w.rootEl?.style.setProperty("--world-freeze", "0");
        // the pointer comes back only once the world beneath is fully on show
        return pause(durationMs).then(() => w.rootEl?.style.setProperty("--world-freeze-events", "none"));
      },
      veilCanvas(opaque, durationMs = veilMs) {
        w.rootEl?.style.setProperty("--world-veil-duration", `${durationMs}ms`);
        w.rootEl?.style.setProperty("--world-veil", `${opaque ? 1 : 0}`);
        return pause(durationMs);
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
        store.patch({ cameraInitial: initial });
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
        store.patch({ dynamicLightIntensity: next });
        state.setPostProcessingEnabled(true);
        state.forceUpdate();
      },
      setDynamicLightRadius(next) {
        state.dynamicLight.setRadius(next);
        state.light.doorsByTile.clear();
        const { displayCenter } = state.dynamicLight;
        const origin = state.dynamicLight.nextTileOrigin(displayCenter.x, displayCenter.z, true);
        origin !== null && state.syncLightDoors(origin.originX, origin.originZ);
        store.patch({ dynamicLightRadius: next });
        state.setPostProcessingEnabled(true);
        state.forceUpdate();
      },
      setRoomLightingEnabled(next = state.roomLight.roomLightingEnabled.value === 0) {
        state.roomLight.setRoomLightingEnabled(next);
        state.roomLightEditingEnabled = next;
        store.patch({ roomLighting: next, roomLightEditing: next });
        state.setPostProcessingEnabled(true);
      },
      setRoomLightIntensity(next) {
        state.roomLightIntensity.value = next;
        store.patch({ roomLightIntensity: next });
        state.setPostProcessingEnabled(true);
        state.forceUpdate();
      },
      setNumCardinalDirections(n) {
        store.patch({ cameraDirections: n });
        state.set({ cameraDirections: n });
        w.update();
      },
      setFx(key, next = state.fx[key].value === 0 ? 1 : 0) {
        if (key === "vignette") state.prevVignette = null; // an explicit choice outranks the focus
        state.fx[key].value = next;
        store.patch({ fx: mapValues(state.fx, (u) => u.value) });
        state.setPostProcessingEnabled(true);
        state.forceUpdate();
      },
      setVignetteFocus(focus) {
        const { vignette } = state.fx;
        // `prevVignette` doubles as "currently focused", so unfocusing twice is a no-op
        const to = focus === true ? 1 : state.prevVignette;
        if (to === null) return;
        state.prevVignette = focus === true ? (state.prevVignette ?? vignette.value) : null;

        cancelAnimationFrame(state.vignetteAnimId);
        const from = vignette.value;
        const startEpochMs = performance.now();
        const step = () => {
          const ratio = Math.min(1, (performance.now() - startEpochMs) / vignetteFocusMs);
          vignette.value = from + (to - from) * ratio;
          state.forceUpdate();
          if (ratio < 1) state.vignetteAnimId = requestAnimationFrame(step);
        };
        step();
      },
      setPostProcessingEnabled(next = !state.postProcessing) {
        state.postProcessing = next;
        store.patch({ postProcessing: next });
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

        getWorldMapStore(w.key, w.mapKey).patch({ roomLit: state.roomLight.getLitRoomPairs() });
        state.setPostProcessingEnabled(true);
        state.forceUpdate();
      },
      setupPostProcessing() {
        const { gl, scene, camera } = w.r3f;
        const scenePass = pass(scene, camera);
        // the extra attachment only exists whilst wanted, so `PostProcessing` rebuilds on toggle.
        // `setMRT` must precede the pipeline, which precompiles the pass
        const outlineEnabled = state.fx.npcOutline.value > 0;
        // one node shared by this pass and the pick pass, so both compile the same shader variant
        state.npcMaskMrt = outlineEnabled === true ? mrt({ output, npcMask: vec4(0) }) : null;
        if (state.npcMaskMrt !== null) {
          scenePass.setMRT(state.npcMaskMrt); // only npcs opt in — see `NPCs.tsx`
        }
        state.syncPickRT();
        w.npc?.syncOutlineMask();
        const sceneColor = scenePass.getTextureNode("output");
        // raw logarithmic depth — litAmount() (room + tracked) does its own log-depth inversion
        const sceneDepth = scenePass.getTextureNode("depth");

        const brightColor = colorBleeding(sceneColor, uniform(0.0025)).mul(vec3(1), sceneColor.a);

        const litEffect = Fn(() => {
          // a flat shape lying on the floor, rather than light falling on whatever it touches —
          // the march gives its outline, walls and doors included
          const insidePolygon = state.dynamicLight.litPolygon(sceneDepth.r);

          const isBright = state.roomLight
            .litAmount(sceneDepth.r)
            // lit rooms start darkening when intensity low
            .mul(select(state.unlitScale.lessThan(0.25), state.unlitScale.div(0.25), 1))
            .mul(state.roomLightIntensity)
            .toVar(); // reused by the vignette below

          const color = mix(sceneColor.rgb.mul(state.unlitScale), brightColor, isBright).toVar();

          // blended TOWARDS the tint rather than multiplied by it, so it still reads at ambient 0,
          // where the world beneath is black and a multiply would vanish
          const tintAmount = state.dynamicLight.intensity;
          color.assign(mix(color, state.dynamicLight.tint, insidePolygon.mul(dynamicFillMix).mul(tintAmount)));

          color.assign(applyVignette(color, state.fx.vignette, isBright));

          const alpha = sceneColor.a.toVar();

          if (outlineEnabled === true) {
            const npcMask = scenePass.getTextureNode("npcMask");
            const outlined = applyNpcOutline(color, npcMask, sceneDepth, state.fx.npcOutline);
            color.assign(outlined.rgb);
            // the outline is painted here rather than drawn in the scene, so nothing has claimed
            // the canvas where it falls on a gap in the floor — and the page would show through it
            alpha.assign(alpha.max(outlined.a));
          }

          return vec4(color, alpha);
        })();

        const pipeline = new THREE.RenderPipeline(gl);
        pipeline.outputNode = litEffect;

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
          state.npcMaskMrt = null;
          state.syncPickRT();
          w.npc?.syncOutlineMask();
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
      setRoomLightEditingWhilstLocked(locked) {
        // a locked extra zoom is for looking, and a long press whilst locked would otherwise
        // relight the room under it. Not persisted: it comes back on unlock, as the user left it
        if (locked === true) {
          if (state.prevRoomLightEditing === null) state.prevRoomLightEditing = state.roomLightEditingEnabled;
          state.roomLightEditingEnabled = false;
        } else if (state.prevRoomLightEditing !== null) {
          state.roomLightEditingEnabled = state.prevRoomLightEditing;
          state.prevRoomLightEditing = null;
        }
      },
      toggleRoomLightEditing() {
        state.prevRoomLightEditing = null; // an explicit choice outranks the restore on unlock
        state.roomLightEditingEnabled = !state.roomLightEditingEnabled;
        store.patch({ roomLightEditing: state.roomLightEditingEnabled });
        w.update();
      },
      commitLightCentre() {
        const { displayCenter } = state.dynamicLight;
        state.dynamicLight.setTracked({ x: displayCenter.x, z: displayCenter.z });
        state.syncLightTile();
        state.pushLightDoorRatios(); // all the per-frame work there is: the rest follows the window
      },
      syncLightTile(force = false) {
        const { displayCenter, tileWorldSize } = state.dynamicLight;
        const next = state.dynamicLight.nextTileOrigin(displayCenter.x, displayCenter.z, force);
        if (next === null) {
          return; // still well inside the window we already have
        }
        if (force === true) {
          state.light.doorsByTile.clear(); // a forced redraw means the doors themselves may be new
        }

        const { originX, originZ } = next;
        const window = tmpRect.set(originX, originZ, tileWorldSize, tileWorldSize);
        const ct = state.dynamicLight.beginTile(originX, originZ);

        state.light.tileDoors = [];
        for (const [gmId, gm] of w.gms.entries()) {
          if (gm.gridRect.intersects(window) === false) {
            continue; // `gridRect` is world space, unlike `gm.bounds`
          }
          const layout = w.assets.layout[gm.key];
          if (layout === undefined) {
            continue;
          }
          // `ct` already maps world -> texture, so composing the instance's own transform lets us
          // draw its LOCAL polygons without cloning any of them
          const { a, b, c, d, e, f } = gm.matrix;
          ct.save();
          ct.transform(a, b, c, d, e, f);
          drawPolygons(ct, layout.walls, { fillStyle: "white", strokeStyle: null });
          ct.restore();

          for (let doorId = 0; doorId < layout.doors.length; doorId++) {
            const door = w.d[`g${gmId}d${doorId}`];
            // `Doors` renders in the r3f tree, a separate React root, so it can still describe the
            // previous layout for a beat after a map edit
            door !== undefined && state.light.tileDoors.push(door);
          }
        }

        state.dynamicLight.endTile();
        state.syncLightDoors(originX, originZ);
      },
      syncLightDoors(originX, originZ) {
        const { tileWorldSize } = state.dynamicLight;
        const tileKey = `${originX},${originZ}` as const;

        // cache reachable doors (could sort by distance)
        let doors = state.light.doorsByTile.get(tileKey);
        if (doors === undefined) {
          // the MAX radius, not the current one: this is cached per tile, so a door dropped here
          // would stay dropped after the slider grew
          const reach = maxDynamicLightRadius + lightDoorMargin + lightTileSize * Math.SQRT1_2;
          const centreX = originX + tileWorldSize / 2;
          const centreZ = originZ + tileWorldSize / 2;
          const distanceTo = (door: (typeof state.light.tileDoors)[number]) =>
            Math.hypot(centreX - (door.src.x + door.dst.x) / 2, centreZ - (door.src.y + door.dst.y) / 2);
          // nearest first, because `setDoors` keeps only as many as it has slots
          doors = state.light.tileDoors
            .filter((door) => distanceTo(door) <= reach)
            .sort((a, b) => distanceTo(a) - distanceTo(b));
          state.light.doorsByTile.set(tileKey, doors);
        }

        state.dynamicLight.setDoors(doors);
        // straight away, not on the next tick: `setDoors` marks every slot inactive until its
        // ratios arrive, and whilst the world is paused there is no next tick — the doors would
        // stop occluding until it resumed. `trackNpc` rebuilds the window, so the intro button
        // hits this exactly
        state.pushLightDoorRatios();
      },
      pushLightDoorRatios() {
        const ids = state.dynamicLight.doorInstanceIds;
        if (state.light.ratios.length !== ids.length) {
          state.light.ratios = new Float32Array(ids.length); // preallocated: this runs every tick
        }
        for (let i = 0; i < ids.length; i++) {
          state.light.ratios[i] = w.door.openRatioArray[ids[i]];
        }
        state.dynamicLight.setDoorRatios(state.light.ratios);
      },
      updateDynamicLight(rawTarget, opts = {}) {
        const { displayCenter } = state.dynamicLight;
        const target = tmpVector3.set(rawTarget.x, rawTarget.y, rawTarget.z);

        if (opts.snap === true) {
          cancelAnimationFrame(state.light.tweenId);
          state.light.tweenId = 0;
        }

        if (state.light.tweenId === 0) {
          if (opts.snap !== true && displayCenter.distanceTo(target) > dynamicLightTweenFrom) {
            state.tweenDynamicLight(); // a teleport e.g. fadeSpawn
          } else {
            displayCenter.copy(target);
          }
        }

        state.commitLightCentre();
      },
      tweenDynamicLight() {
        cancelAnimationFrame(state.light.tweenId);
        const { displayCenter } = state.dynamicLight;
        let lastEpochMs = performance.now();

        // self-driving, so the light also catches up whilst the world is paused
        const step = () => {
          const position = state.dynamicLightTarget?.position;
          if (position === undefined) {
            state.light.tweenId = 0;
            return;
          }

          const nowEpochMs = performance.now();
          const deltaSecs = (nowEpochMs - lastEpochMs) / 1000;
          lastEpochMs = nowEpochMs;

          const target = tmpVector3.set(position.x, position.y, position.z);
          displayCenter.lerp(target, 1 - Math.exp(-dynamicLightTweenRate * deltaSecs));

          if (displayCenter.distanceTo(target) > dynamicLightTweenUntil) {
            state.light.tweenId = requestAnimationFrame(step);
          } else {
            displayCenter.copy(target);
            state.light.tweenId = 0;
          }

          state.commitLightCentre(); // a teleport can cross several super-tiles
          w.r3f?.invalidate();
        };

        state.light.tweenId = requestAnimationFrame(step);
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
        // the page behind the canvas keeps the theme's own colour whatever the ambient is — see
        // `World`'s className. Dimming it with the world made the stripes vanish at ambient 0
        style={{ filter: `brightness(${w.brightness})` }}
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

        <PerspectiveCamera fov={getCameraFov(bounds.width / bounds.height)} makeDefault zoom={1} />

        <CameraControls
          ref={state.ref("controls")}
          cameraMode={state.cameraMode}
          numCardinalDirections={state.cameraDirections}
          fixedPolar={w.touchDevice && state.cameraMode === "cardinal"}
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

      {/* the black, and over it the held frame that dips through it — see `world.css` */}
      <div className="world-veil" />
      <canvas
        className="world-freeze"
        ref={state.ref("freezeEl")}
        // the capture is of the raw drawing buffer, so it needs the canvas's own filter to match
        style={{ filter: `brightness(${w.brightness})` }}
      />
      {/* over the held frame: progress whilst it is up, a map swap being far from instant */}
      <div className="world-spinner">
        <Spinner className="size-16" />
      </div>

      <AnimatePresence>
        {w.disabled && (
          <motion.div
            className="absolute inset-x-0 top-[60%] flex justify-center pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="px-4 py-1.5 rounded-full bg-black text-white/80 border border-white/40 text-xs font-mono tracking-[0.3em] uppercase select-none">
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
  /** Non-null whilst the npc outline is on, when materials write an extra `npcMask` output */
  npcMaskMrt: null | ReturnType<typeof mrt>;
  /** Keeps `pickRT`'s attachment count in step with `npcMaskMrt` */
  syncPickRT(): void;
  raycaster: THREE.Raycaster;
  objectPick: THREE.UniformNode<"float", number>;
  /** `0` (force off), `0.5` (when on ignore walls), `1` (when on pick walls too) */
  objectPickScale: 0 | 0.5 | 1;
  postProcessing: boolean;
  /** Cheap post effects, each `0` (off) or `1` (on) */
  fx: Record<FxKey, ReturnType<typeof uniform<"float", number>>>;
  /** Toggles (or sets) one of `fx` */
  setFx(key: FxKey, next?: number): void;
  /** The vignette before the extra zoom lock forced it to max, else `null` */
  prevVignette: null | number;
  /** Whilst the extra zoom is locked the vignette tweens to max, focusing on the target */
  setVignetteFocus(focus: boolean): void;
  vignetteAnimId: number;
  roomLight: RoomLightPostprocess;
  /** Toggled via long-press on WorldMenu's lights icon; gates long-press room toggling in `use-world-events.ts` */
  roomLightEditingEnabled: boolean;
  /** What room-light editing was before a locked extra zoom suspended it, else `null` */
  prevRoomLightEditing: null | boolean;
  /** Suspends room-light editing whilst the extra zoom is locked, restoring it after */
  setRoomLightEditingWhilstLocked(locked: boolean): void;
  /** Persisted, user-controlled brightness of a lit room (0..1) — see `defaultRoomLightIntensity` */
  roomLightIntensity: THREE.UniformNode<"float", number>;
  unlitScale: THREE.UniformNode<"float", number>;
  /** Persisted magnitude backing `dimWorldColor` — see `defaultAmbientIntensity` */
  ambientIntensity: number;
  dynamicLight: DynamicLightPostprocess;
  /** Set by `w.npc.trackNpc`; `position` is a live reference (e.g. `npc.position`), not a snapshot. `null` means off. Lives outside `dynamicLight` so it survives that object's HMR reset (see the re-hydration effect in `WorldView`). */
  dynamicLightTarget: null | { npcKey: string; position: { x: number; y: number; z: number } };
  /** What the dynamic light needs on the CPU: its tween, and the doors it occludes against */
  light: {
    /** Non-zero whilst the tracked light is catching up with a teleported target */
    tweenId: number;
    /** Preallocated open ratios for the doors holding a slot, pushed every tick */
    ratios: Float32Array;
    /** Every door of every instance the occupancy window covers — candidates below */
    tileDoors: Geomorph.DoorState[];
    /** Doors near each window we have visited, keyed by its origin — see `syncLightDoors` */
    doorsByTile: Map<string, Geomorph.DoorState[]>;
  };

  createRenderer(props: DefaultGLProps): Promise<THREE.WebGPURenderer>;
  forceUpdate(delta?: number): void;
  pickObject(e: React.PointerEvent<HTMLDivElement>): void;
  onCreated(rootState: RootState): void;
  onKeyDown(e: KeyboardEvent): void;
  onKeyUp(e: KeyboardEvent): void;
  /** When Shift went down, so its release can tell a tap from a hold */
  shiftDownMs: number;
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
  /**
   * Moves the camera's orbit target onto `groundPoint`, preserving its orientation.
   * Resolves on arrival. Zoom is preserved unless `radius` is given, which is tweened alongside.
   */
  lookAt(groundPoint: Geom.VectJson, opts?: { animate?: boolean; radius?: number; height?: number }): Promise<void>;
  /** Non-zero whilst `lookAt` is animating */
  lookAtAnimId: number;
  /** Are the background stripes currently faded down, the camera having moved? */
  stripesFaded: boolean;
  /** Pending restore, restarted by every camera change — see `fadeStripes` */
  stripeTimer: number;
  /** Fades the stripes down whilst the camera moves, and back once it has been still */
  fadeStripes(): void;
  /** Points the light at its own `displayCenter`, recentring the window and its doors as needed */
  commitLightCentre(): void;
  /** Redraws the world-space occupancy window if the light has left its middle super-tile */
  syncLightTile(force?: boolean): void;
  /** Gives the doors near this window their occlusion slots, caching the choice per window */
  syncLightDoors(originX: number, originZ: number): void;
  /** Pushes live open ratios for whichever doors hold a slot — the only per-frame door work */
  pushLightDoorRatios(): void;
  /** Animates `ambientIntensity`, persisting the final value */
  /** `0` the world is folded flat, `1` full height — for anything that folds in its shader */
  foldNode: THREE.UniformNode<"float", number>;
  /** Takes the page background to black and back, whilst a map loads */
  dimBackground(darken: boolean, durationMs?: number): Promise<void>;
  /** Black over the canvas contents, hiding a floor swap — see `world.css` */
  veilCanvas(opaque: boolean, durationMs?: number): Promise<void>;
  freezeEl: HTMLCanvasElement;
  frozen: boolean;
  /** Holds the last rendered frame on screen, so the world can change unseen beneath it */
  freezeCanvas(): void;
  /** Fades the held frame away, revealing whatever the world is now */
  unfreezeCanvas(durationMs?: number): Promise<void>;
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

/** How much of `tint` washes over what that outline encloses */
const dynamicFillMix = 0.05;

/** What the background stripes' alpha is scaled by whilst the camera moves */
const movingStripeAlpha = 0.3;
/** How still the camera must be before they come back */
const stripeRestoreMs = 250;

/** How long the vignette takes to reach max whilst the extra zoom locks, and to come back */
const vignetteFocusMs = 300;

/** Shift held longer than this is a hold, not a tap — see `onKeyUp` */
const shiftTapMs = 300;

/**
 * `fov` is vertical, so a short wide viewport derives an ever wider horizontal one — 91° at
 * 16:9 but 127° at 3.5:1, where the edges smear. Keep `cameraFov` up to `cameraRefAspect`,
 * then hold the horizontal angle that implies and close the vertical instead.
 */
function getCameraFov(aspect: number) {
  // `false` for the NaN of an unmeasured element, leaving the fov alone
  if (!(aspect > cameraRefAspect)) return cameraFov;
  const halfTan = Math.tan(cameraFov * 0.5 * THREE.MathUtils.DEG2RAD);
  return 2 * Math.atan((halfTan * cameraRefAspect) / aspect) * THREE.MathUtils.RAD2DEG;
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
/** How far past the light's radius a door still gets an occlusion slot */
const lightDoorMargin = 1.5;

/** Tween ends once this close (world units) to the target */
const dynamicLightTweenUntil = 0.05;
/** Exponential approach rate of the tween, per second */
const dynamicLightTweenRate = 6;
/** How long the background takes to go black, or to come back */
const bgDimMs = 300;
/** How long the veil over the canvas takes to fade, either way */
const veilMs = 250;
/** How long the held frame takes to give way to the map beneath it */
const freezeFadeMs = 700;
/** Default duration of `fadeAmbient` */
const ambientFadeDurationMs = 1000;

/** The intro pans from here to the player, via `w.player.panToPlayer` */
/**
 * `MRTNode` maps its entries onto attachments by texture *name* (see `getTextureIndex`), which
 * `PassNode` sets for us but a hand-made target does not — leave them unnamed and the pick
 * colour never reaches attachment 0.
 */
function createPickRT(count: 1 | 2) {
  const renderTarget = new THREE.RenderTarget(1, 1, { format: THREE.RGBAFormat, count });
  renderTarget.textures[0].name = "output";
  if (renderTarget.textures[1]) {
    renderTarget.textures[1].name = "npcMask";
  }
  return renderTarget;
}

function defaultInitialCamera(touchDevice: boolean): State["initial"] {
  return {
    azimuthal: 0,
    polar: Math.PI / 4,
    position: { x: 4, y: touchDevice ? 10 : 16, z: 4 },
  };
}

function PostProcessing() {
  const w = useContext(WorldContext);
  // the npc outline needs an extra pass attachment, so flipping it rebuilds the pipeline
  const outlineEnabled = (w.view.fx?.npcOutline.value ?? 0) > 0;
  useEffect(() => w.view.setupPostProcessing(), [outlineEnabled]);
  return null;
}

export type FxKey = keyof typeof fxDefaults;

/** Add a key here, a branch in `setupPostProcessing`, and an entry in `debugItems` (`WorldMenu`) */
const fxDefaults = { vignette: defaultVignette, npcOutline: 0 };

const tmpVect = new Vect();
const tmpRect = new Rect();
const tmpVector3 = new THREE.Vector3();
const tmpLookAtOffset = new THREE.Vector3();

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
