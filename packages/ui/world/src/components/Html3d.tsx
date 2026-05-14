import { cn, useStateRef } from "@npc-cli/util";
import type { RootState } from "@react-three/fiber";
import { useFrame } from "@react-three/fiber";
import * as React from "react";
import * as ReactDOM from "react-dom/client";
import * as THREE from "three";
import { html3DOpacityCssVar } from "../const";

export type TrackedObject3D = { object: THREE.Object3D; offset: THREE.Vector3 };

type Props = Omit<React.HTMLAttributes<HTMLDivElement>, "ref"> & {
  docked?: boolean;
  baseScale?: number;
  offset?: THREE.Vector3Like;
  r3f: RootState;
  position: THREE.Vector3;
  tracked: TrackedObject3D | null;
  visible: boolean;
};

export type State = {
  baseScale?: number;
  delta: [number, number];
  domTarget: HTMLElement | null;
  innerDiv: HTMLDivElement;
  rootDiv: HTMLDivElement;
  reactRoot: ReactDOM.Root;
  zoom: number;
  onFrame(rootState?: RootState): void;
  computePosition(): [number, number];
};

export const Html3d = React.forwardRef<State, Props>(
  ({ baseScale, children, className, docked, offset, position, r3f, tracked, visible }, ref) => {
    const state = useStateRef(
      (): State => ({
        baseScale: 0,
        delta: [0, 0],
        domTarget: null,
        innerDiv: null!,
        rootDiv: document.createElement("div"),
        reactRoot: null!,
        zoom: 0,

        onFrame(_rootState) {
          if (docked === true || state.innerDiv === null) {
            return;
          }

          r3f.camera.updateMatrixWorld();
          const vec = state.computePosition();

          if (
            Math.abs(state.zoom - r3f.camera.zoom) > eps ||
            Math.abs(state.delta[0] - vec[0]) > eps ||
            Math.abs(state.delta[1] - vec[1]) > eps
          ) {
            state.rootDiv.style.transform = `translate3d(${vec[0]}px,${vec[1]}px,0)`;

            if (state.baseScale !== baseScale) {
              if (baseScale === undefined) {
                state.innerDiv.style.transition = "transform 300ms";
                state.innerDiv.style.transform = "scale(1)";
              } else {
                state.innerDiv.style.transition = "";
              }
              state.baseScale = baseScale;
            }

            if (baseScale !== undefined) {
              if (tracked === null) {
                v1.copy(position);
              } else {
                v1.setFromMatrixPosition(tracked.object.matrixWorld).add(tracked.offset);
              }
              const scale = objectScale(v1, r3f.camera) * baseScale;
              state.innerDiv.style.transform = `scale(${scale})`;
            }

            state.delta = vec;
            state.zoom = r3f.camera.zoom;
          }
        },

        computePosition() {
          if (tracked === null) {
            v1.copy(position);
          } else {
            v1.setFromMatrixPosition(tracked.object.matrixWorld).add(tracked.offset);
          }
          if (offset !== undefined) {
            v1.add(offset);
          }
          return calculatePosition(v1, r3f.camera, r3f.get().size);
        },
      }),
      { deps: [baseScale, docked, offset, position, tracked] },
    );

    React.useImperativeHandle(ref, () => state, []);

    state.domTarget = (r3f.gl.domElement.parentNode?.parentNode as HTMLElement) ?? null;

    React.useLayoutEffect(() => {
      const currentRoot = (state.reactRoot = ReactDOM.createRoot(state.rootDiv));
      const vec = state.computePosition();
      state.rootDiv.style.transform = `translate3d(${vec[0]}px,${vec[1]}px,0)`;
      state.domTarget?.appendChild(state.rootDiv);
      return () => {
        state.domTarget?.removeChild(state.rootDiv);
        currentRoot.unmount();
      };
    }, [state.domTarget]);

    React.useLayoutEffect(() => {
      state.reactRoot?.render(
        <div
          ref={state.ref("innerDiv")}
          children={children}
          {...(docked && { transform: "scale(1)" })}
          className="origin-left"
        />,
      );

      setTimeout(() => {
        state.zoom = 0;
        state.onFrame();
      });
    });

    React.useLayoutEffect(() => {
      if (docked ? state.innerDiv : state.rootDiv) {
        state.rootDiv.className = cn({ docked }, className);
        const { style } = state.rootDiv;
        style.visibility = visible ? "visible" : "hidden";
        style.transition = docked ? "" : "opacity ease-out 100ms";
        style.opacity = docked ? "" : `var(${html3DOpacityCssVar})`;
      }
    }, [state.rootDiv, state.innerDiv, className, docked, visible]);

    useFrame(state.onFrame);

    return null;
  },
);

const eps = 0.001;
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

function calculatePosition(
  objectPos: THREE.Vector3,
  camera: THREE.Camera,
  size: { width: number; height: number },
): [number, number] {
  objectPos.project(camera);
  const widthHalf = size.width / 2;
  const heightHalf = size.height / 2;
  return [objectPos.x * widthHalf + widthHalf, -(objectPos.y * heightHalf) + heightHalf];
}

function objectScale(objectPos: THREE.Vector3, camera: THREE.Camera) {
  if (camera instanceof THREE.OrthographicCamera) {
    return camera.zoom;
  } else if (camera instanceof THREE.PerspectiveCamera) {
    const cameraPos = v2.setFromMatrixPosition(camera.matrixWorld);
    const vFOV = (camera.fov * Math.PI) / 180;
    const dist = objectPos.distanceTo(cameraPos);
    const scaleFOV = 2 * Math.tan(vFOV / 2) * dist;
    return 1 / scaleFOV;
  } else {
    return 1;
  }
}
