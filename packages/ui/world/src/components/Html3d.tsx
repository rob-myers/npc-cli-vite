import { cn, useStateRef } from "@npc-cli/util";
import type { RootState } from "@react-three/fiber";
import { useFrame } from "@react-three/fiber";
import { forwardRef, useImperativeHandle, useLayoutEffect } from "react";
import * as ReactDOM from "react-dom/client";
import * as THREE from "three";

export const Html3d = forwardRef<State, Props>((props, ref) => {
  const state = useStateRef(
    (): State => ({
      delta: { x: 0, y: 0 },
      domTarget: null,
      innerDiv: emptyDiv,
      rootDiv: document.createElement("div"),
      reactRoot: {} as ReactDOM.Root,
      zoom: 0,

      onFrame(_rootState) {
        if (state.innerDiv === emptyDiv) {
          return;
        }

        props.r3f.camera.updateMatrixWorld();
        const vec = state.computePosition();

        if (
          Math.abs(state.zoom - props.r3f.camera.zoom) > eps ||
          Math.abs(state.delta.x - vec.x) > eps ||
          Math.abs(state.delta.y - vec.y) > eps
        ) {
          state.rootDiv.style.transform = `translate3d(${vec.x}px,${vec.y}px,0)`;

          v1.setFromMatrixPosition(props.tracked.object.matrixWorld).add(props.tracked.offset);
          const scale = objectScale(v1, props.r3f.camera) * baseScale;
          state.innerDiv.style.transform = `scale(${scale})`;

          state.delta = vec;
          state.zoom = props.r3f.camera.zoom;
        }
      },

      computePosition() {
        v1.setFromMatrixPosition(props.tracked.object.matrixWorld).add(props.tracked.offset);
        v1.add(props.offset); // e.g. manually offset speech bubble
        return calculatePosition(v1, props.r3f.camera, props.r3f.get().size);
      },
    }),
    { deps: [props.offset, props.position, props.tracked] },
  );

  useImperativeHandle(ref, () => state, []);

  state.domTarget = (props.r3f.gl.domElement.parentNode?.parentNode as HTMLElement) ?? null;
  state.rootDiv.className = props.className;

  useLayoutEffect(() => {
    const currentRoot = (state.reactRoot = ReactDOM.createRoot(state.rootDiv));
    const vec = state.computePosition();
    state.rootDiv.style.transform = `translate3d(${vec.x}px,${vec.y}px,0)`;
    state.domTarget?.appendChild(state.rootDiv);
    return () => {
      state.domTarget?.removeChild(state.rootDiv);
      currentRoot.unmount();
    };
  }, [state.domTarget]);

  useLayoutEffect(() => {
    state.reactRoot.render?.(
      <div
        ref={state.ref("innerDiv")}
        children={props.children}
        className={cn("origin-top-left", !props.visible && "invisible")}
      />,
    );

    setTimeout(() => {
      state.zoom = 0; // force update on hmr
      state.onFrame();
    });
  });

  useFrame(state.onFrame);

  return null;
});

const eps = 0.001;
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const baseScale = 2;
const emptyDiv = document.createElement("div");

function calculatePosition(
  objectPos: THREE.Vector3,
  camera: THREE.Camera,
  size: { width: number; height: number },
): Geom.VectJson {
  objectPos.project(camera);
  const widthHalf = size.width / 2;
  const heightHalf = size.height / 2;
  return { x: objectPos.x * widthHalf + widthHalf, y: -(objectPos.y * heightHalf) + heightHalf };
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

export type TrackedObject3D = { object: THREE.Object3D; offset: THREE.Vector3 };

type Props = Omit<React.HTMLAttributes<HTMLDivElement>, "ref"> & {
  className: string;
  offset: THREE.Vector3Like;
  r3f: RootState;
  position: THREE.Vector3;
  tracked: TrackedObject3D;
  visible: boolean;
};

export type State = {
  delta: Geom.VectJson;
  domTarget: HTMLElement | null;
  innerDiv: HTMLDivElement;
  rootDiv: HTMLDivElement;
  reactRoot: ReactDOM.Root;
  zoom: number;
  onFrame(rootState?: RootState): void;
  computePosition(): Geom.VectJson;
};
