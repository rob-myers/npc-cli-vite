import { useContext } from "react";
import * as THREE from "three/webgpu";
import { crosshairY } from "../const.env";
import { groundCrosshairOf } from "../service/geometry";
import { WorldContext } from "./world-context";

/**
 * Where a `embodied` zoom-in is heading — see `WorldView`'s `onZoomWheel`, and its
 * `setCrosshair` which moves it and `fadeCrosshair` which fades it
 */
export default function CrossHair() {
  const w = useContext(WorldContext);
  const cross = groundCrosshairOf(w.themeKey);
  return (
    <mesh
      ref={w.view.ref("zoomCrossEl")}
      visible={false}
      // straight after the floor and obstacles (`-3`), so all else draws over it
      renderOrder={-2.5}
      geometry={cross.geometry}
      position={[0, crosshairY, 0]}
    >
      <meshBasicMaterial
        color={cross.color}
        transparent
        depthTest
        depthWrite={false}
        side={THREE.DoubleSide}
        forceSinglePass
      />
    </mesh>
  );
}
