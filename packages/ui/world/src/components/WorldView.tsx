import { cn, useStateRef } from "@npc-cli/util";
import { type MapControlsProps, PerspectiveCamera, Stats } from "@react-three/drei";
import { Canvas, type RootState } from "@react-three/fiber";
import { useContext } from "react";
import * as THREE from "three/webgpu";
import type { CameraControls as BaseCameraControls } from "../service/camera-controls";
import { CameraControls } from "./CameraControls";
import { WorldContext } from "./world-context";

export function WorldView(props: React.PropsWithChildren<{ className?: string }>) {
  const w = useContext(WorldContext);

  const state = useStateRef<State>(() => ({
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
      maxDistance: 35,
      panSpeed: 2,
      rotateSpeed: 0.5,
      zoomSpeed: 0.3,
      // zoomToCursor: true, // breaks follow zoom on HMR
    },
    rootEl: null as any,

    canvasRef(canvasEl) {
      if (canvasEl !== null) {
        state.canvas = canvasEl;
        state.rootEl = canvasEl.parentElement?.parentElement as HTMLDivElement;
      }
    },
    async createRenderer(props: Record<string, unknown>) {
      const renderer = new THREE.WebGPURenderer(props as ConstructorParameters<typeof THREE.WebGPURenderer>[0]);
      // renderer.toneMapping = 3;
      // renderer.toneMappingExposure = 1;
      // // renderer.logarithmicDepthBuffer = true; // set via constructor if needed
      // renderer.setPixelRatio(window.devicePixelRatio);
      await renderer.init();
      return renderer;
    },
    onCreated(rootState) {
      w.threeReady = true;
      w.r3f = rootState as typeof w.r3f;
      w.update(); // e.g. show stats
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
  }));

  w.view = state;

  return (
    <Canvas
      className={props.className}
      ref={state.canvasRef}
      frameloop={state.syncRenderMode()}
      gl={state.createRenderer}
      onCreated={state.onCreated}
    >
      {props.children}

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

      <PerspectiveCamera position={[0, 18, 0]} makeDefault fov={30} zoom={1} />

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
    </Canvas>
  );
}

export type State = {
  canvas: HTMLCanvasElement;
  controls: BaseCameraControls;
  ctrlOpts: MapControlsProps;
  rootEl: HTMLDivElement;

  canvasRef(canvasEl: null | HTMLCanvasElement): void;
  createRenderer(props: Record<string, unknown>): Promise<THREE.WebGPURenderer>;
  onCreated(rootState: RootState): void;
  syncRenderMode(): RootState["frameloop"];
};
