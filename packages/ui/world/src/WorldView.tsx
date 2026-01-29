import { cn, useStateRef } from "@npc-cli/util";
import { Box, type MapControlsProps, PerspectiveCamera, Stats } from "@react-three/drei";
import { Canvas, type RenderProps, type RootState } from "@react-three/fiber";
import { useContext, useEffect } from "react";
import { CameraControls } from "./CameraControls";
import type { CameraControls as BaseCameraControls } from "./camera-controls";
import { WorldContext } from "./world-context";

export function WorldView() {
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
    glOpts: {
      toneMapping: 3,
      toneMappingExposure: 1,
      logarithmicDepthBuffer: true,
      pixelRatio: window.devicePixelRatio,
    },
    rootEl: null as any,
    canvasRef(canvasEl) {
      if (canvasEl !== null) {
        state.canvas = canvasEl;
        state.rootEl = canvasEl.parentElement?.parentElement as HTMLDivElement;
      }
    },
    syncRenderMode() {
      return w.disabled ? "demand" : "always";
    },
  }));

  useEffect(() => {
    // Force initial render to show Stats
    state.update();
  }, []);

  return (
    <Canvas
      className="relative"
      ref={state.canvasRef}
      frameloop={state.syncRenderMode()}
      gl={state.glOpts}
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

      <Box position={[-1.2, 0, 0]}>
        <meshBasicMaterial wireframe />
      </Box>
    </Canvas>
  );
}

type State = {
  canvas: HTMLCanvasElement;
  controls: BaseCameraControls;
  ctrlOpts: MapControlsProps;
  glOpts: RenderProps<HTMLCanvasElement>["gl"];
  rootEl: HTMLDivElement;
  canvasRef(canvasEl: null | HTMLCanvasElement): void;
  syncRenderMode(): RootState["frameloop"];
};
