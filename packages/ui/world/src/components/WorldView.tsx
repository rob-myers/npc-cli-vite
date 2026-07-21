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
  cameraModeStorageKey,
  connectorEntranceHalfDepth,
  defaultCameraMode,
  defaultCardinalDirectionsDesktop,
  defaultCardinalDirectionsMobile,
  defaultDesktopFov,
  defaultMobileFov,
  fovStorageKey,
  lightEditingEnabledKey,
  lightRoomOutset,
  lightSizingGrowDurationMs,
  lightSizingMaxRadius,
  lightSizingStartRadius,
  lightsEnabledKey,
  numCardinalDirectionsKey,
  postProcessingEnabledKey,
  showDebugLightOutlineKey,
  wallHeight,
} from "../const";
import type { CameraControls as BaseCameraControls } from "../service/camera-controls";
import { computeIntersectionNormal, getTempInstanceMesh } from "../service/geometry";
import { decodePick } from "../service/pick";
import type { SelectAnyType } from "../service/texture";
import { createXzCylinderPostprocess, type XzCylinderPostprocess } from "../service/xz-cylinder-postprocess";
import { CameraControls, type CameraModeType } from "./CameraControls";
import NpcBubbles from "./NpcBubbles";
import { WorldContext } from "./world-context";

export function WorldView(props: React.PropsWithChildren<{ className?: string }>) {
  const { uiStoreApi } = useContext(UiContext);
  const w = useContext(WorldContext);

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
        azimuthal: w.touchDevice ? 0 : -Math.PI / 4,
        polar: Math.PI / 4,
        position: { x: 4, y: w.touchDevice ? 10 : 24, z: 4 },
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
      lightPostprocess: createXzCylinderPostprocess({
        showBorder: tryLocalStorageGetParsed<boolean>(showDebugLightOutlineKey) ?? false,
        lightsEnabled: tryLocalStorageGetParsed<boolean>(lightsEnabledKey) ?? true,
        bottomHeight: 0,
        topHeight: wallHeight + 0.5, // cover npc on top-bunk
      }),
      /** Toggled via long-press on WorldMenu's light icon; gates long-press add/remove */
      lightEditingEnabled: tryLocalStorageGetParsed<boolean>(lightEditingEnabledKey) ?? true,
      lightSizing: null,
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
        w.r3f = rootState as typeof w.r3f;
        // re-upload textures on new GPU context (e.g. Chrome cmd+shift+t double init)
        w.texFloor.update();
        w.update(); // e.g. show stats
      },
      onResize: debounce(() => {
        w.menu?.onResize();
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
        if (state.lightSizing) {
          state.commitLightSizing();
        }
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

        if (state.lightSizing) {
          state.commitLightSizing();
          return;
        }
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

        // refresh the shared camera matrices on every rendered frame — so every light keeps
        // rendering correctly (rather than with stale matrices) as the camera pans/rotates/zooms
        const camera = state.controls?.object ?? w.r3f.camera;
        state.lightPostprocess.update(camera);

        if (state.lightSizing !== null) {
          state.updateLightSizing();
          // keep the demand-frameloop render chain alive frame-by-frame while paused, mirroring
          // the extraZoom tween's self-sustaining invalidate() idiom
          w.r3f?.invalidate();
        }
      },
      toggleLightEditing() {
        state.lightEditingEnabled = !state.lightEditingEnabled;
        tryLocalStorageSet(lightEditingEnabledKey, String(state.lightEditingEnabled));
        w.update();
      },
      setLightsEnabled(next = state.lightPostprocess.lightsEnabled.value === 0) {
        state.lightPostprocess.setLightsEnabled(next);
        tryLocalStorageSet(lightsEnabledKey, String(next));
        state.setPostProcessingEnabled(true);
      },
      computeRoomOutline(gmRoomId) {
        const gm = w.gms[gmRoomId.gmId];
        const room = gm.rooms[gmRoomId.roomId];
        // outset a little (`.clone()` — createOutset mutates its input) so the light doesn't
        // cut off exactly at the room's inner wall face
        const outsetRoom = geomService.createOutset(room.clone(), lightRoomOutset);
        // also union in adjacent doorways, so the light already covers the doorway itself —
        // avoids a brief "partially dark" moment while an npc is mid-transition through a door
        // (room-change detection only fires once they've fully crossed to the other side)
        const doorwayPolys = gm.doors
          .filter((d) => d.roomIds.includes(gmRoomId.roomId))
          .map((d) =>
            d.computeThinPoly(
              d.meta.hull === true ? 2 * connectorEntranceHalfDepth.hull : 2 * connectorEntranceHalfDepth.nonHull,
            ),
          );
        const merged = Poly.union([...outsetRoom, ...doorwayPolys]);
        const extended = merged.reduce((a, b) => (a.outline.length >= b.outline.length ? a : b));
        return extended.outline.map((p) => gm.matrix.transformPoint({ x: p.x, y: p.y }));
      },
      noLightsInRoom(gmRoomId) {
        const roomDecor = w.decor.byRoom[gmRoomId.gmId][gmRoomId.roomId];
        // ≤ 1 or 1st takes precedence
        const decorLabel = roomDecor
          ?.values()
          .find((d): d is Geomorph.DecorPoint => d.type === "point" && typeof d.meta.label === "string");
        return decorLabel === undefined || decorLabel.meta.label === "corridor" || decorLabel.meta.unlit === true;
      },
      isFullyLitRoom(gmRoomId) {
        const roomDecor = w.decor.byRoom[gmRoomId.gmId]?.[gmRoomId.roomId];
        if (!roomDecor) return false;
        for (const d of roomDecor) {
          if (d.type === "point" && d.meta.label === "fresher") return true;
        }
        return false;
      },
      startLightSizing(groundCenter) {
        // find the room `center` is in, so the light can be clipped to its world-space outline
        const gmRoomId = w.e.findRoomContaining(groundCenter, true);

        if (!gmRoomId) {
          return; // must be in some room
        }
        if (state.noLightsInRoom(gmRoomId)) {
          return; // lights aren't permitted in this room
        }

        const roomOutline = state.computeRoomOutline(gmRoomId);

        if (state.isFullyLitRoom(gmRoomId)) {
          // light up fully and instantly instead of growing from a small circle
          const radius = roomOutline.reduce(
            (max, p) => Math.max(max, Math.hypot(p.x - groundCenter.x, p.y - groundCenter.y)),
            0,
          );
          const index = state.lightPostprocess.addLight(groundCenter, radius, roomOutline);
          if (index === null) {
            // all MAX_POSTPROCESS_LIGHTS slots full
            w.menu?.set({ toastTs: { ...w.menu.toastTs, "lights full": Date.now() } });
          }
          state.forceUpdate();
          return;
        }

        state.lightSizing = {
          center: groundCenter,
          startEpochMs: Date.now(),
          radius: lightSizingStartRadius,
          roomOutline,
        };
        state.lightPostprocess.setPreview(groundCenter, state.lightSizing.radius);
        state.lightPostprocess.setPreviewRoomOutline(roomOutline);
        if (state.controls) state.controls.enabled = false; // suppress camera pan/rotate while sizing
        state.forceUpdate();
      },
      updateLightSizing() {
        if (!state.lightSizing) return;
        const elapsedMs = Date.now() - state.lightSizing.startEpochMs;
        const t = Math.min(1, elapsedMs / lightSizingGrowDurationMs);
        const radius = lightSizingStartRadius + t * (lightSizingMaxRadius - lightSizingStartRadius);
        state.lightSizing.radius = radius;
        state.lightPostprocess.setPreview(state.lightSizing.center, radius);
      },
      commitLightSizing() {
        if (!state.lightSizing) return;
        const { center, radius, roomOutline } = state.lightSizing;
        const index = state.lightPostprocess.addLight(center, radius, roomOutline);
        state.lightPostprocess.setPreview(null);
        if (state.controls) state.controls.enabled = true;
        state.lightSizing = null;
        if (index === null) {
          // all MAX_POSTPROCESS_LIGHTS slots full
          w.menu?.set({ toastTs: { ...w.menu.toastTs, "lights full": Date.now() } });
        }
        state.forceUpdate();
      },
      resetAllLights() {
        state.lightPostprocess.resetLights();
        state.setPostProcessingEnabled(true);
      },
      setCameraMode(mode) {
        state.cameraMode = mode;
        tryLocalStorageSet(cameraModeStorageKey, mode);
        w.update();
      },
      setNumCardinalDirections(n) {
        state.numCardinalDirections = n;
        tryLocalStorageSet(numCardinalDirectionsKey, String(n));
        w.update();
      },
      setPostProcessingEnabled(next = !state.postProcessing) {
        state.postProcessing = next;
        tryLocalStorageSet(postProcessingEnabledKey, String(next));
        state.forceUpdate();
      },
      setupPostProcessing() {
        const gl = w.r3f.gl as unknown as THREE.WebGPURenderer;
        const { scene, camera } = w.r3f;
        const scenePass = pass(scene, camera);
        const sceneColor = scenePass.getTextureNode("output");
        // raw (logarithmic) depth — litAmount() does its own log-depth inversion
        const sceneDepth = scenePass.getTextureNode("depth");

        const pipeline = new THREE.RenderPipeline(gl);

        const outsideAmount = float(1).sub(state.lightPostprocess.litAmount(sceneDepth.r));
        let effect = mix(
          colorBleeding(sceneColor, uniform(0.0025)).mul(sceneColor.a),
          sceneColor.rgb.mul(vec3(0.1, 0.4, 0.7)), // tint
          outsideAmount,
        );
        // 🚧 remove?
        effect = state.lightPostprocess.drawBorder(effect);
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
    { reset: { ctrlOpts: true, initial: false, lightPostprocess: true } },
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
          minPanDistance={0}
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
  lightPostprocess: XzCylinderPostprocess;
  /** Toggled via long-press on WorldMenu's light icon; gates long-press add/remove in `use-world-events.ts` */
  lightEditingEnabled: boolean;
  /** Active while long-pressing to place a NEW light and still holding — grows over time. `null` when idle. */
  lightSizing: null | {
    center: Geom.VectJson;
    startEpochMs: number;
    radius: number;
    /** World-space outline of the room `center` is in — empty if none found. For debug rendering. */
    roomOutline: Geom.VectJson[];
  };
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
  toggleLightEditing(): void;
  /** Toggles `lightPostprocess.lightsEnabled` — persisted to localStorage */
  setLightsEnabled(next?: boolean): void;
  /** World-space outline of `gmRoomId`'s room, outset slightly (see `lightRoomOutset`) — used by `startLightSizing` */
  computeRoomOutline(gmRoomId: Geomorph.GmRoomId): Geom.VectJson[];
  /** No labelled decor point, or a labelled point with `meta.corridor === true` — such rooms don't permit lights at all */
  noLightsInRoom(gmRoomId: Geomorph.GmRoomId): boolean;
  /** A labelled point with `meta.label === "fresher"` — such rooms light up fully and instantly instead of growing */
  isFullyLitRoom(gmRoomId: Geomorph.GmRoomId): boolean;
  /** Begins a hold-to-grow preview (via the independent `preview` light channel) for a new light being placed at `center`, unless lights aren't permitted (see `noLightsInRoom`) or it's fully-lit (see `isFullyLitRoom`) */
  startLightSizing(groundCenter: Geom.VectJson): void;
  /** Grows `lightSizing.radius` based on elapsed hold time — called every frame from `onCameraChange` */
  updateLightSizing(): void;
  /** Commits the current `lightSizing` preview as a static light (or discards if `lightSizing` is `null`) */
  commitLightSizing(): void;
  /** Deactivates every static light */
  resetAllLights(): void;
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
