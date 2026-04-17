import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, useStateRef } from "@npc-cli/util";
import { type MapControlsProps, PerspectiveCamera, Stats } from "@react-three/drei";
import { Canvas, type RootState } from "@react-three/fiber";
import type { DefaultGLProps } from "@react-three/fiber/dist/declarations/src/core/renderer";
import { motion } from "motion/react";
import { useContext } from "react";
import * as THREE from "three/webgpu";
import type { CameraControls as BaseCameraControls } from "../service/camera-controls";
import { decodePick, objectPick } from "../service/pick";
import { CameraControls } from "./CameraControls";
import { WorldContext } from "./world-context";

export function WorldView(props: React.PropsWithChildren<{ className?: string }>) {
  const { uiStoreApi } = useContext(UiContext);
  const w = useContext(WorldContext);

  const state = useStateRef<State>(
    () => ({
      canvas: null as any,
      controls: null as any,
      ctrlOpts: {
        minAzimuthAngle: -Infinity,
        maxAzimuthAngle: +Infinity,
        // minPolarAngle: Math.PI * 0,
        minPolarAngle: (Math.PI * 1) / 8,
        // maxPolarAngle: Math.PI * 1/2,
        maxPolarAngle: (Math.PI * 1) / 2.5,
        // minDistance: 1.5, // target could be ground or npc head
        minDistance: 5, // target could be ground or npc head
        maxDistance: 60,
        panSpeed: 2,
        rotateSpeed: 0.5,
        zoomSpeed: 0.3,
        // zoomToCursor: true, // breaks follow zoom on HMR
      },
      rootEl: null as any,

      pickRT: new THREE.RenderTarget(1, 1, { format: THREE.RGBAFormat }),

      canvasRef(canvasEl) {
        if (canvasEl !== null) {
          state.canvas = canvasEl;
          state.rootEl = canvasEl.parentElement?.parentElement as HTMLDivElement;
        }
      },
      async createRenderer(props: DefaultGLProps) {
        // 🔔 fix mismatched canvas size on chrome re-open tab (cmd+shift+t)
        // - "The depth stencil attachment [TextureView of Texture "depthBuffer"] size (width: 300, height: 150) does not match the size of the other attachments' base plane (width: 1190, height: 1296). "
        const canvas = props.canvas as HTMLCanvasElement;
        const parent = canvas.parentElement as HTMLDivElement;
        const parentRect = parent.getBoundingClientRect();
        if (parentRect.width > 0 && parentRect.height > 0) {
          canvas.width = parentRect.width * devicePixelRatio;
          canvas.height = parentRect.height * devicePixelRatio;
        }

        const renderer = new THREE.WebGPURenderer({
          canvas,
          antialias: true,
          logarithmicDepthBuffer: true,
          powerPreference: "high-performance",
          // forceWebGL: true,
        });
        renderer.onDeviceLost = (event) => {
          console.warn("WebGPU device lost", event);
        };

        await renderer.init();
        return renderer;
      },
      doObjectPick(offsetX, offsetY) {
        const { gl, scene, camera } = w.r3f;
        const renderer = gl as unknown as THREE.WebGPURenderer;

        const x = Math.floor(offsetX * gl.getPixelRatio());
        const y = Math.floor(offsetY * gl.getPixelRatio());

        const rt = state.pickRT;
        const rtCamera = camera;
        const size = new THREE.Vector2();
        renderer.getDrawingBufferSize(size);
        rtCamera.setViewOffset(size.x, size.y, x, y, 1, 1);

        objectPick.value = 1;
        renderer.setRenderTarget(rt);
        renderer.render(scene, rtCamera);
        objectPick.value = 0;
        renderer.setRenderTarget(null);
        rtCamera.clearViewOffset();

        renderer.readRenderTargetPixelsAsync(rt, 0, 0, 1, 1).then((rgba) => {
          const picked = state.getPickedFromPixel(rgba);
          console.log("picked", picked);
          picked !== null && w.events.next({ key: "picked", meta: picked });
        });
      },
      getPickedFromPixel([r, g, b, _a]) {
        // console.log(`pixel @ (${x}, ${y}):`, { r, g, b, a });
        const pick = decodePick(r, g, b);

        switch (pick?.type) {
          case "floor":
          case "ceiling": {
            const gm = w.gms[pick.instanceId];
            if (gm) {
              // 🚧 transform click to local coords for roomId lookup via pickRoomId
              return { ...pick, gmKey: gm.key };
            }
            return null;
          }
          case "walls": {
            const decoded = w.wall.decodeInstanceId(pick.instanceId);
            return { ...pick, ...decoded };
          }
          case "obstacles": {
            const decoded = w.obs.decodeInstanceId(pick.instanceId);
            return { ...pick, ...decoded };
          }
          case "doors": {
            const decoded = w.door.decodeInstanceId(pick.instanceId);
            return { ...pick, ...decoded };
          }
          default:
            return null;
        }
      },
      onCreated(rootState) {
        w.threeReady = true;
        w.r3f = rootState as typeof w.r3f;
        // re-upload textures on new GPU context (e.g. Chrome cmd+shift+t double init)
        w.texFloor.update();
        w.update(); // e.g. show stats
        document.addEventListener("keydown", state.onKeyDown);
      },
      onKeyDown(e: KeyboardEvent) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (e.key === "Escape") {
          uiStoreApi.setUiMeta(w.id, (draft) => (draft.disabled = true));
        } else if (e.key === "Enter") {
          uiStoreApi.setUiMeta(w.id, (draft) => (draft.disabled = false));
        }
      },
      async onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
        state.doObjectPick(e.nativeEvent.offsetX, e.nativeEvent.offsetY);

        e.currentTarget.focus();
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
    }),
    { reset: { ctrlOpts: true } },
  );

  w.view = state;

  return (
    <motion.div
      className="size-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 2, delay: 0.1 }}
    >
      <Canvas
        className={props.className}
        style={{ filter: `brightness(${w.brightness})` }}
        ref={state.canvasRef}
        frameloop={state.syncRenderMode()}
        gl={state.createRenderer}
        onCreated={state.onCreated}
        onPointerDown={state.onPointerDown}
        resize={{ debounce: 0 }}
        flat // 🔔 hopefully fix sporadic colorspace issues on refresh
        tabIndex={0}
      >
        {state.rootEl && (
          <Stats
            showPanel={0}
            className={cn(
              w.disabled && "pointer-events-none filter grayscale(1) brightness(0.5)",
              "absolute! z-500! left-[unset]! right-0",
            )}
            parent={{ current: state.rootEl as HTMLDivElement }}
          />
        )}

        <PerspectiveCamera fov={40} position={[0, 18, 0]} makeDefault zoom={1} />

        <CameraControls
          ref={state.ref("controls")}
          domElement={state.canvas}
          initialAngle={{
            azimuthal: Math.PI / 4,
            polar: Math.PI / 3.8,
          }}
          minPanDistance={0}
          // onChange={state.onChangeControls}
          // onEnd={state.onControlsEnd}
          // onStart={state.onControlsStart}
          {...state.ctrlOpts}
        />

        {props.children}
      </Canvas>
    </motion.div>
  );
}

export type State = {
  canvas: HTMLCanvasElement;
  controls: BaseCameraControls;
  ctrlOpts: MapControlsProps;
  pickRT: THREE.RenderTarget;
  rootEl: HTMLDivElement;

  canvasRef(canvasEl: null | HTMLCanvasElement): void;
  createRenderer(props: DefaultGLProps): Promise<THREE.WebGPURenderer>;
  doObjectPick(offsetX: number, offsetY: number): void;
  onCreated(rootState: RootState): void;
  onKeyDown(e: KeyboardEvent): void;
  onPointerDown(e: React.PointerEvent<HTMLDivElement>): void;
  getPickedFromPixel(
    rgba: THREE.TypedArray | [number, number, number, number],
  ): { type: string; instanceId: number; gmKey?: string } | null;
  syncRenderMode(): RootState["frameloop"];
};
