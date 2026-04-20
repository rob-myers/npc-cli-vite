import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, useStateRef } from "@npc-cli/util";
import { testNever } from "@npc-cli/util/legacy/generic";
import { type MapControlsProps, PerspectiveCamera, Stats } from "@react-three/drei";
import { Canvas, type RootState } from "@react-three/fiber";
import type { DefaultGLProps } from "@react-three/fiber/dist/declarations/src/core/renderer";
import debounce from "debounce";
import { motion } from "motion/react";
import { useContext, useEffect } from "react";
import * as THREE from "three/webgpu";
import type { CameraControls as BaseCameraControls } from "../service/camera-controls";
import { computeIntersectionNormal, getTempInstanceMesh } from "../service/geometry";
import { decodePick, type ObjectPickKey, objectPick } from "../service/pick";
import { CameraControls } from "./CameraControls";
import { WorldContext } from "./world-context";

export function WorldView(props: React.PropsWithChildren<{ className?: string }>) {
  const { uiStoreApi } = useContext(UiContext);
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      canvas: null as any,
      controls: null as any,
      clickIds: [],
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
      pickRT: new THREE.RenderTarget(1, 1, { format: THREE.RGBAFormat }),
      raycaster: new THREE.Raycaster(),

      async createRenderer(props: DefaultGLProps) {
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
      forceRender() {
        w.r3f?.invalidate();
      },
      getPickedFromPixel([r, g, b, _a]) {
        // console.log(`pixel @ (${x}, ${y}):`, { r, g, b, a });
        const pick = decodePick(r, g, b);

        switch (pick?.type) {
          case "floor":
          case "ceiling": {
            const gmId = pick.instanceId;
            const gm = w.gms[gmId];
            if (!gm) return null;
            // 🚧 transform click to local coords for roomId lookup via pickRoomId
            return { ...pick, gmId, gmKey: gm.key, ...(pick.type === "floor" ? { floor: true } : { ceiling: true }) };
          }
          case "wall": {
            const { gmId, meta } = w.wall.decodeInstanceId(pick.instanceId);
            return { ...pick, gmId, ...meta };
          }
          case "obstacle": {
            const decoded = w.obs.decodeInstanceId(pick.instanceId);
            return { ...pick, ...decoded };
          }
          case "door": {
            const decoded = w.door.decodeInstanceId(pick.instanceId);
            return { ...pick, ...decoded };
          }
          case "npc": {
            const npc = w.npc.byPickId[pick.instanceId];
            if (npc) return { ...pick, npcKey: npc.key };
            return null;
          }
          default:
            return null;
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
          // case "quad":
          //   mesh = getTempInstanceMesh(w.decor.quadInst, decoded.instanceId);
          //   break;
          case "obstacle":
            mesh = getTempInstanceMesh(w.obs.inst as THREE.InstancedMesh, picked.instanceId);
            break;
          case "ceiling":
            mesh = getTempInstanceMesh(w.ceil.inst as THREE.InstancedMesh, picked.instanceId);
            break;
          // case "cuboid":
          //   mesh = getTempInstanceMesh(w.decor.cuboidInst, decoded.instanceId);
          //   break;
          // case "lock-light":
          //   mesh = getTempInstanceMesh(w.door.lockSigInst, decoded.instanceId);
          //   break;
          default:
            throw testNever(picked.type);
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
        document.addEventListener("keydown", state.onKeyDown);
      },
      onResize: debounce(() => {
        w.menu?.onResize();
      }, 100),
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
        state.pickObject(e);
        e.currentTarget.focus();
      },
      pickObject(e) {
        const { gl, scene, camera } = w.r3f;
        const renderer = gl as unknown as THREE.WebGPURenderer;

        const x = Math.floor(e.nativeEvent.offsetX * gl.getPixelRatio());
        const y = Math.floor(e.nativeEvent.offsetY * gl.getPixelRatio());

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
          if (picked === null) return;
          const intersection = state.getRaycastIntersection(e.nativeEvent, picked);
          console.log("picked", picked, intersection);
          if (intersection === null) return;

          const { distance, point } = intersection;
          const clickId = state.clickIds.pop();

          w.events.next({
            key: "picked",
            ...(clickId && { clickId }),
            meta: picked,
            distance,
            point,
            faceIndex: intersection.faceIndex,
            normal: intersection.normal,
            ...point, // can provide as point
          });
        });
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

  useEffect(() => {
    if (!w.rootEl) return;
    const ro = new ResizeObserver(([entry]) => {
      // only trigger when visible
      entry.contentRect.width && state.onResize();
    });
    ro.observe(w.rootEl);
    return () => ro.disconnect();
  }, [w.rootEl]); // debounced resize

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
        ref={state.ref("canvas")}
        frameloop={state.syncRenderMode()}
        gl={state.createRenderer}
        onCreated={state.onCreated}
        onPointerDown={state.onPointerDown}
        resize={{ debounce: 0 }}
        flat // 🔔 hopefully fix sporadic colorspace issues on refresh
        tabIndex={0}
      >
        {w.rootEl && (
          <Stats
            showPanel={0}
            className={cn(
              w.disabled && "pointer-events-none filter grayscale(1) brightness(0.5)",
              "absolute! z-500! left-[unset]! right-0",
            )}
            parent={{ current: w.rootEl as HTMLDivElement }}
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
  clickIds: string[];
  controls: BaseCameraControls;
  ctrlOpts: MapControlsProps;
  pickRT: THREE.RenderTarget;
  raycaster: THREE.Raycaster;

  createRenderer(props: DefaultGLProps): Promise<THREE.WebGPURenderer>;
  forceRender(): void;
  pickObject(e: React.PointerEvent<HTMLDivElement>): void;
  onCreated(rootState: RootState): void;
  onKeyDown(e: KeyboardEvent): void;
  onResize(): void;
  onPointerDown(e: React.PointerEvent<HTMLDivElement>): void;
  getPickedFromPixel(
    rgba: THREE.TypedArray | [number, number, number, number],
  ): Meta<{ type: ObjectPickKey; instanceId: number; gmKey?: string }> | null;
  getRaycastIntersection: (e: PointerEvent, picked: JshCli.DecodedObjectPick) => null | THREE.Intersection;
  syncRenderMode(): RootState["frameloop"];
};
