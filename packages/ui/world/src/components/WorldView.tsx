import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, ExhaustiveError, useStateRef } from "@npc-cli/util";
import { Vect } from "@npc-cli/util/geom";
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
  cameraPositionStorageKey,
  defaultAmbientIntensity,
  defaultCameraMode,
  defaultCardinalDirectionsDesktop,
  defaultCardinalDirectionsMobile,
  defaultDesktopFov,
  defaultMobileFov,
  defaultRoomLightIntensity,
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
import { decodePick } from "../service/pick";
import { createRoomLightPostprocess, type RoomLightPostprocess } from "../service/room-light-postprocess";
import { type AmbientMood, computeDimWorldColor, type SelectAnyType } from "../service/texture";
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
      initial: tryLocalStorageGetParsed<State["initial"]>(cameraPositionStorageKey) ?? {
        azimuthal: w.touchDevice ? 0 : Math.PI / 4,
        polar: Math.PI / 4,
        position: { x: 4, y: w.touchDevice ? 10 : 16, z: 4 },
      },
      lastCameraReading: { azimuthal: 0, polar: 0, position: { x: 0, y: 0, z: 0 } },
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
      /** Toggled via long-press on WorldMenu's lights icon; gates long-press room toggling */
      roomLightEditingEnabled: tryLocalStorageGetParsed<boolean>(roomLightEditingEnabledKey) ?? true,
      // capped at wallHeight (not +0.5 like roomLight) — the extra margin reached into the
      // ceiling geometry, causing aliasing when looking down at it (the "background"/no-depth
      // fallback in litAmount() projects onto the topHeight plane, which didn't line up with
      // the actual ceiling surface once it extended past wallHeight)
      dynamicLight: createDynamicLightPostprocess({
        bottomHeight: 0,
        topHeight: wallHeight - 0.01, // avoid ceiling aliasing
        marchSteps: w.touchDevice ? 48 : 96,
      }),
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

        const camera = state.controls?.object ?? w.r3f.camera;
        state.roomLight.update(camera);
        state.dynamicLight.update(camera);
      },
      onCameraEnd() {
        state.lastCameraReading.azimuthal = state.controls.spherical.theta;
        state.lastCameraReading.polar = state.controls.spherical.phi;
        state.lastCameraReading.position.x = state.controls.target.x;
        state.lastCameraReading.position.y = state.controls.spherical.radius;
        state.lastCameraReading.position.z = state.controls.target.z;
        tryLocalStorageSet(cameraPositionStorageKey, JSON.stringify(state.lastCameraReading));
      },
      updateDynamicLight(rawTarget) {
        state.dynamicLight.displayCenter.copy(rawTarget);
        state.dynamicLight.setTracked({ x: state.dynamicLight.displayCenter.x, z: state.dynamicLight.displayCenter.z });
        state.dynamicLight.setActiveGmDoorRatios(
          state.dynamicLight.activeGmDoorInstanceIds.map((id) => w.door.openRatioArray[id]),
        );
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
      setDynamicLightRadius(next) {
        state.dynamicLight.setRadius(next);
        state.setPostProcessingEnabled(true);
        state.forceUpdate();
      },
      setDynamicLightIntensity(next) {
        state.dynamicLight.setIntensity(next);
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
        tryLocalStorageSet(`${roomLitStorageKeyPrefix}:${w.mapKey}`, JSON.stringify(state.roomLight.getLitRoomPairs()));
        state.setPostProcessingEnabled(true);
        state.forceUpdate();
      },
      resetAllRooms() {
        state.roomLight.resetAllRooms();
        tryLocalStorageSet(`${roomLitStorageKeyPrefix}:${w.mapKey}`, JSON.stringify([]));
        state.setPostProcessingEnabled(true);
      },
      setupDom() {
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
      },
      setupLights() {
        state.roomLight.syncGms(w.gms, w.gmsData);
        const savedLitRooms = tryLocalStorageGetParsed<[number, number][]>(`${roomLitStorageKeyPrefix}:${w.mapKey}`);
        if (savedLitRooms) {
          state.roomLight.setRoomLitPairs(savedLitRooms);
        }
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
        // "bright" if a lit room's own (scaled-down) brightness OR the dynamic light reaches here —
        // combine via max BEFORE inverting, not after: this way a lit room whose own intensity is
        // below 1 still lets the dynamic light stand out above it, instead of one flattening the other.
        const isBright = state.roomLight
          .litAmount(sceneDepth.r)
          .mul(state.roomLightIntensity)
          .max(state.dynamicLight.litAmount(sceneDepth.r).mul(state.dynamicLight.intensity));
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
    { reset: { ctrlOpts: true, initial: false, dimWorldColor: true, dynamicLight: true } },
  );

  w.view = state;

  useEffect(() => {
    if (w.rootEl) {
      return state.setupDom();
    }
  }, [w.rootEl, state.onKeyDown]);

  useEffect(() => {
    state.setupLights();
  }, [w.hash, w.gmsData, w.mapKey]);

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
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="px-4 py-1.5 rounded-full bg-black/40 backdrop-blur-xs border border-white/40 text-white/40 text-xs font-mono tracking-[0.3em] uppercase select-none">
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
  /** Latest camera reading, updated every frame by `onCameraChange` — persisted by `onCameraEnd` */
  lastCameraReading: { azimuthal: number; polar: number; position: { x: number; y: number; z: number } };
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
  dimWorldColor: THREE.UniformNode<"vec3", THREE.Vector3>;
  /** Persisted magnitude backing `dimWorldColor` — see `defaultAmbientIntensity` */
  ambientIntensity: number;
  /** Persisted mood tint backing `dimWorldColor`, else `null` (neutral) */
  ambientMood: AmbientMood | null;
  dynamicLight: DynamicLightPostprocess;
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
  /** Advances `dynamicLight.displayCenter` from a live target — called every tick from `World`'s `onTick` while `dynamicLight.target` is set (see `w.npc.trackNpc`) */
  updateDynamicLight(rawTarget: { x: number; y: number; z: number }): void;
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
  setAmbientIntensity(next: number): void;
  /** Sets (or clears, if already active) the world's ambient mood tint (persisted) */
  setAmbientMood(next: Exclude<AmbientMood, null>): void;
  /** No labelled decor point, or a labelled point with `meta.corridor === true` / `meta.unlit === true` — such rooms don't permit lighting at all */
  roomLightingDisallowed(gmRoomId: Geomorph.GmRoomId): boolean;
  /** Toggles whether `gmRoomId`'s room is lit, unless lighting isn't permitted there (see `roomLightingDisallowed`) */
  toggleRoomLit(groundCenter: Geom.VectJson): void;
  /** Clears every lit room */
  resetAllRooms(): void;
  /** Debounced resize + key events */
  setupDom(): () => void;
  setupLights(): void;
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
