import { useFrame, useThree } from "@react-three/fiber";
import { forwardRef, useEffect, useMemo } from "react";
import * as THREE from "three";
import { shallow } from "zustand/shallow";
import { CameraControls as MapControlsImpl } from "../service/camera-controls";

/**
 * Based on:
 * > https://github.com/pmndrs/drei/blob/master/src/core/MapControls.tsx
 * @type {React.ForwardRefExoticComponent<
 *   React.PropsWithChildren<Props> & React.RefAttributes<MapControlsImpl>
 * >}
 */
export const CameraControls = forwardRef(function CameraControls(props, ref) {
  const r3f = useThree(
    (s) => ({
      invalidate: s.invalidate,
      camera: /** @type {import('three').PerspectiveCamera} */ (s.camera),
      gl: s.gl,
      events: s.events,
      set: s.set,
      get: s.get,
    }),
    shallow,
  );

  const domEl = props.domElement ?? r3f.gl.domElement;

  const controls = useMemo(() => {
    const mc = new MapControlsImpl(r3f.camera, /** @type {*} */ ({}));

    // set initial angle
    const azimuthal = props.initialAzimuthal ?? 0;
    const polar = props.initialPolar ?? 0;
    // set initial position
    mc.target.copy({ x: props.initialPosition?.x ?? 0, y: 0, z: props.initialPosition?.z ?? 0 });
    // `update` seeds `zoomProgress` from this on its first run — it cannot be done here, the
    // stops arriving as props only after this memo has built the controls
    const radius = props.initialPosition?.y ?? 20;
    const delta = new THREE.Vector3().setFromSphericalCoords(radius, polar, azimuthal);
    mc.object.position.copy(mc.target).add(delta);
    mc.update();

    const prev = r3f.get().controls;
    if (prev instanceof MapControlsImpl) {
      // 🚧 restore on HMR
      mc.setParams(prev.params);
      mc.target.copy(prev.target);
    }

    return mc;
  }, [r3f.camera, MapControlsImpl]);

  useEffect(() => {
    controls.connect(domEl);
    const changeCallback = /** @param {import('three').Event} e */ (e) => {
      r3f.invalidate();
      props.onChange?.(e);
    };
    controls.addEventListener("change", changeCallback);
    if (props.onStart) controls.addEventListener("start", props.onStart);
    if (props.onEnd) controls.addEventListener("end", props.onEnd);

    return () => {
      controls.dispose();
      controls.removeEventListener("change", changeCallback);
      if (props.onStart) controls.removeEventListener("start", props.onStart);
      if (props.onEnd) controls.removeEventListener("end", props.onEnd);
    };
  }, [props.onChange, props.onStart, props.onEnd, domEl, controls, r3f.invalidate]);

  useEffect(() => {
    const old = r3f.get().controls;
    r3f.set({ controls });
    controls.setParams({
      fixedPolar: props.fixedPolar ?? false,
    });
    return () => r3f.set({ controls: old });
  }, [props.fixedPolar, controls]);

  useFrame(() => {
    controls.update();
    props.onFrame?.(controls.spherical, controls.target);
  }, -1);

  return (
    <primitive
      object={controls}
      ref={ref}
      enableDamping
      minAzimuthAngle={props.minAzimuthAngle}
      maxAzimuthAngle={props.maxAzimuthAngle}
      minPolarAngle={props.minPolarAngle}
      maxPolarAngle={props.maxPolarAngle}
      minDistance={props.minDistance}
      maxDistance={props.maxDistance}
      minPanDistance={props.minPanDistance}
      panSpeed={props.panSpeed}
      rotateSpeed={props.rotateSpeed}
      zoomSpeed={props.zoomSpeed}
      zoomToCursor={props.zoomToCursor}
    />
  );
});

/**
 * @typedef Props
 * @property {HTMLElement} domElement
 * @property {boolean} [fixedPolar] Pin the polar angle, leaving azimuth and zoom
 * @property {number} [initialAzimuthal]
 * @property {number} [initialPolar]
 * @property {{ x: number; y: number; z: number }} [initialPosition]
 * @property {number} [minAzimuthAngle]
 * @property {number} [maxAzimuthAngle]
 * @property {number} [minDistance]
 * @property {number} [maxDistance]
 * @property {number} [minPolarAngle]
 * @property {number} [maxPolarAngle]
 * @property {number} [minPanDistance] // 🚧 implement in controls (from patch to make mobile touch more precise)
 * @property {(e?: import('three').Event) => void} [onChange]
 * @property {() => void} [onEnd]
 * @property {(spherical: import('three').Spherical, target: import('three').Vector3) => void} [onFrame]
 * @property {() => void} [onStart]
 * @property {number} [panSpeed]
 * @property {number} [rotateSpeed]
 * @property {number} [zoomSpeed]
 * @property {boolean} [zoomToCursor] Zoom towards the cursor or pinch, moving `target` with it.
 * Off whilst following a player, whose zoom should stay centred on them
 */

/**
 * @typedef {MapControlsImpl & import('three').EventDispatcher<{
 *   start: import('three').Event;
 *   change: import('three').Event;
 *   end: import('three').Event;
 * }>} ControlsImpl
 */

/**
 * @typedef {"free" | "follow"} CameraModeType
 */
