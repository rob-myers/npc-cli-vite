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
import { motion } from "motion/react";
import { useContext, useEffect } from "react";
import { colorBleeding, vignette } from "three/addons/tsl/display/CRT.js";
import { float, instanceIndex, output, pass, screenUV, select, uniform, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import {
  cameraModeStorageKey,
  defaultCameraModeDesktop,
  defaultCameraModeMobile,
  defaultFov,
  fovStorageKey,
} from "../const";
import type { CameraControls as BaseCameraControls } from "../service/camera-controls";
import { computeIntersectionNormal, getTempInstanceMesh } from "../service/geometry";
import { decodePick } from "../service/pick";
import type { SelectAnyType } from "../service/texture";
import { CameraControls, type CameraModeType } from "./CameraControls";
import NpcBubbles from "./NpcBubbles";
import { WorldContext } from "./world-context";

export function WorldView(props: React.PropsWithChildren<{ className?: string }>) {
  const { uiStoreApi } = useContext(UiContext);
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      cameraMode:
        tryLocalStorageGet<CameraModeType>(cameraModeStorageKey) ??
        (w.touchDevice ? defaultCameraModeMobile : defaultCameraModeDesktop),
      canvas: null as any,
      controls: null as any,
      clickIds: [],
      topDown: false,
      ctrlOpts: {
        minAzimuthAngle: -Infinity,
        maxAzimuthAngle: +Infinity,
        minPolarAngle: Math.PI / 64,
        maxPolarAngle: Math.PI / 4,
        minDistance: w.touchDevice ? 5 : 5,
        maxDistance: 60,
        extraZoom: 2,
        panSpeed: 2,
        rotateSpeed: 0.5,
        zoomSpeed: 0.3,
      },
      initial: {
        azimuthal: Math.PI / 4,
        polar: Math.PI / 4,
        position: { x: 4, y: 12, z: 4 },
      },
      lastPointer: { point: new Vect(), epochMs: 0, longPressTimer: 0, longPress: false, rightPress: false },
      pickRT: new THREE.RenderTarget(1, 1, { format: THREE.RGBAFormat }),
      raycaster: new THREE.Raycaster(),
      objectPick: uniform(0),
      objectPickScale: 0.5, // do not walls by default
      postProcessing: true,
      fov: tryLocalStorageGetParsed<number>(fovStorageKey) ?? defaultFov,

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
          // forceWebGL: true,
        });
        renderer.onDeviceLost = (event) => {
          console.warn("WebGPU device lost", event);
        };
        renderer.setPixelRatio(window.devicePixelRatio);

        await renderer.init();
        return renderer;
      },
      forceUpdate(delta = 0) {
        w.npc.onTick(delta); // enough to tick a frame
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
            return { ...pick, decor: true, ...decoded };
          }
          case "runtimeDecor": {
            const decoded = w.decor.decodeRuntimeInstanceId(pick.instanceId);
            if (!decoded) return null;
            return { ...pick, type: "decor", decor: true, runtime: true, ...decoded };
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
        w.view.raycaster.setFromCamera(normalizedDeviceCoords, w.r3f.camera);

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
        last.point.copy(getRelativePointer(e));
        last.epochMs = Date.now();
        last.longPress = false;
        last.rightPress = isRMB(e.nativeEvent);
        last.longPressTimer = window.setTimeout(() => {
          last.longPress = true;
          state.pickObject(e);
        }, 500);
        const mod = e.shiftKey || e.ctrlKey || e.metaKey;
        state.canvas.style.cursor = mod ? "grabbing" : "move";
      },
      onPointerLeave(_e) {
        clearTimeout(state.lastPointer.longPressTimer);
        state.lastPointer.longPressTimer = 0;
        state.canvas.style.cursor = "";
      },
      async onPointerUp(e) {
        const last = state.lastPointer;
        clearTimeout(last.longPressTimer);
        last.longPressTimer = 0;
        state.canvas.style.cursor = "";
        e.currentTarget.focus();
        if (last.longPress) return;
        if (last.point.distanceTo(getRelativePointer(e)) > (w.touchDevice ? 20 : 5)) return;
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
          meta: { ...picked, ...gmRoomId, nav: w.npc.getClosestPoly(point).success },
          gmRoomId,

          distance,
          point,
          faceIndex: intersection.faceIndex,
          normal: intersection.normal,

          longDown: state.lastPointer.longPress,
          rightDown: state.lastPointer.rightPress,

          ...point, // can provide as point with meta
        });
      },
      onCameraChange(spherical: THREE.Spherical) {
        const nowTopDown = spherical.phi <= 2 * (Math.PI / 18);
        if (nowTopDown !== state.topDown) {
          state.topDown = nowTopDown;
          w.bubble?.onChangeTopDown(nowTopDown);
        }
      },
      setCameraMode(mode) {
        state.cameraMode = mode;
        tryLocalStorageSet(cameraModeStorageKey, mode);
        w.update();
      },
      setupPostProcessing() {
        const gl = w.r3f.gl as unknown as THREE.WebGPURenderer;
        const { scene, camera } = w.r3f;
        const scenePass = pass(scene, camera);
        const sceneColor = scenePass.getTextureNode("output");

        const pipeline = new THREE.RenderPipeline(gl);

        pipeline.outputNode = vec4(
          colorBleeding(
            vignette(
              sceneColor.rgb, // The input image color
              float(1.4), // Intensity (0 to 1): Higher = thicker dark edges
              float(0.7), // Smoothness: Controls gradient falloff softness
              screenUV, // Coordinates mapping
            ),
            uniform(0.003),
          ),
          sceneColor.a,
        );

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
      withPickOutput(typeId, colorScale = 1) {
        const idx = float(instanceIndex);
        const pickVec = vec4(float(typeId).div(255), idx.div(256).floor().div(255), idx.mod(256).div(255), output.a);
        // 🔔 SelectAnyType fixes horrible: Expression produces a union type that is too complex to represent.
        return (select as SelectAnyType)(state.objectPick.notEqual(0), pickVec, output.mul(colorScale));
      },
      withPickOutputId(typeId, idUniform) {
        const idx = float(idUniform);
        const pickVec = vec4(float(typeId).div(255), idx.div(256).floor().div(255), idx.mod(256).div(255), output.a);
        return (select as SelectAnyType)(state.objectPick.notEqual(0), pickVec, output);
      },
    }),
    { reset: { ctrlOpts: true, postProcessing: true, initial: false } },
  );

  w.view = state;

  useEffect(() => {
    if (!w.rootEl) return;

    // only trigger when visible
    const ro = new ResizeObserver(([entry]) => {
      entry.contentRect.width && state.onResize();
    });
    ro.observe(w.rootEl);

    w.rootEl.addEventListener("keydown", state.onKeyDown);

    const onExtraZoomChange = (_e: Event) => w.update();
    w.rootEl.addEventListener("extrazoomchange", onExtraZoomChange);

    return () => {
      ro.disconnect();
      w.rootEl?.removeEventListener("keydown", state.onKeyDown);
      w.rootEl?.removeEventListener("extrazoomchange", onExtraZoomChange);
    };
  }, [w.rootEl, state.onKeyDown]); // debounced resize + key events

  return (
    <motion.div
      className={cn(
        "size-full",
        w.disabled && !w.menu.suppressGrayscale ? "grayscale-100 brightness-75" : "grayscale-0 brightness-100",
        "transition-[filter] duration-1000",
      )}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 2, delay: 0.1 }}
    >
      <Canvas
        className={props.className}
        style={{ filter: `brightness(${w.brightness}) contrast(${w.contrast})` }}
        ref={state.ref("canvas")}
        frameloop={state.syncRenderMode()}
        gl={state.createRenderer}
        onCreated={state.onCreated}
        onPointerDown={state.onPointerDown}
        onPointerLeave={state.onPointerLeave}
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
    </motion.div>
  );
}

export type State = {
  cameraMode: CameraModeType;
  canvas: HTMLCanvasElement;
  clickIds: { id: string; blocking: boolean }[];
  controls: BaseCameraControls;
  topDown: boolean;
  ctrlOpts: MapControlsProps & { extraZoom?: number };
  initial: { azimuthal: number; polar: number; position: { x: number; y: number; z: number } };
  lastPointer: { point: Geom.Vect; epochMs: number; longPressTimer: number; longPress: boolean; rightPress: boolean };
  pickRT: THREE.RenderTarget;
  raycaster: THREE.Raycaster;
  objectPick: THREE.UniformNode<"float", number>;
  /** `0` (force off), `0.5` (when on ignore walls), `1` (when on pick walls too) */
  objectPickScale: 0 | 0.5 | 1;
  postProcessing: boolean;
  fov: number;

  createRenderer(props: DefaultGLProps): Promise<THREE.WebGPURenderer>;
  forceUpdate(delta?: number): void;
  pickObject(e: React.PointerEvent<HTMLDivElement>): void;
  onCreated(rootState: RootState): void;
  onKeyDown(e: KeyboardEvent): void;
  onResize(): void;
  onPointerDown(e: React.PointerEvent<HTMLDivElement>): void;
  onPointerLeave(e: React.PointerEvent<HTMLDivElement>): void;
  onPointerUp(e: React.PointerEvent<HTMLDivElement>): void;
  getPickedFromPixel(rgba: THREE.TypedArray | [number, number, number, number]): Picked | null;
  getRaycastIntersection: (e: PointerEvent, picked: Picked) => null | THREE.Intersection;
  onCameraChange(spherical: THREE.Spherical): void;
  setCameraMode(mode: CameraModeType): void;
  syncRenderMode(): RootState["frameloop"];
  /**
   * TSL node for `outputNode`: when state.objectPick==1, outputs raw unlit pick color;
   * otherwise passes through the standard lit `output`.
   *
   * We include `colorScale` here because scaling colorNode on
   * transparent material broke picking.
   */
  withPickOutput(typeId: number, colorScale?: number): THREE.Node;
  /** Like `withPickOutput` but uses a uniform instead of `instanceIndex` (for non-instanced meshes). */
  withPickOutputId(typeId: number, idUniform: THREE.UniformNode<"float", number>): THREE.Node;
  setupPostProcessing(): () => void;
};

function PostProcessing() {
  const w = useContext(WorldContext);
  useEffect(() => w.view.setupPostProcessing(), []);
  return null;
}

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
