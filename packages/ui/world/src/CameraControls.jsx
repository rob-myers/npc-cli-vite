import { useFrame, useThree } from "@react-three/fiber";
import React from "react";
import * as THREE from "three";
import { shallow } from "zustand/shallow";
import { CameraControls as MapControlsImpl } from "./camera-controls";

/**
 * Based on:
 * > https://github.com/pmndrs/drei/blob/master/src/core/MapControls.tsx
 * @type {React.ForwardRefExoticComponent<
 *   React.PropsWithChildren<Props> & React.RefAttributes<MapControlsImpl>
 * >}
 */
export const CameraControls = React.forwardRef(function CameraControls(props, ref) {
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

  const controls = React.useMemo(() => {
    const mc = new MapControlsImpl(r3f.camera, /** @type {*} */ ({}));

    // set initial angle
    const azimuthal = props.initialAngle?.azimuthal ?? 0;
    const polar = props.initialAngle?.polar ?? 0;
    const delta = new THREE.Vector3().setFromSphericalCoords(mc.getDistance(), polar, azimuthal);
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

  React.useEffect(() => {
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

  React.useEffect(() => {
    const old = r3f.get().controls;
    r3f.set({ controls });
    return () => r3f.set({ controls: old });
  }, [controls]);

  useFrame(() => controls.update(), -1);

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
      panSpeed={props.panSpeed}
      zoomSpeed={props.zoomSpeed}
      zoomToCursor={props.zoomToCursor}
    />
  );
});

/**
 * @typedef Props
 * @property {HTMLElement} domElement
 * @property {(e?: import('three').Event) => void} [onChange]
 * @property {() => void} [onEnd]
 * @property {() => void} [onStart]
 * @property {{ azimuthal: number; polar: number; }} [initialAngle]
 * @property {number} [minAzimuthAngle]
 * @property {number} [maxAzimuthAngle]
 * @property {number} [minDistance]
 * @property {number} [maxDistance]
 * @property {number} [minPolarAngle]
 * @property {number} [maxPolarAngle]
 * @property {number} [minPanDistance] // 🚧 implement in controls (from patch to make mobile touch more precise)
 * @property {number} [panSpeed]
 * @property {number} [zoomSpeed]
 * @property {boolean} [zoomToCursor]
 */

/**
 * @typedef {MapControlsImpl & import('three').EventDispatcher<{
 *   start: import('three').Event;
 *   change: import('three').Event;
 *   end: import('three').Event;
 * }>} ControlsImpl
 */
