import { useContext } from "react";
import * as THREE from "three/webgpu";
import { crosshairY } from "../const";
import { createGroundCrosshairGeometry } from "../service/geometry";
import { WorldContext } from "./world-context";

/**
 * Where a `canonical` zoom-in is heading — see `WorldView`'s `onZoomWheel`, and its
 * `setCrosshair` which moves it and `fadeCrosshair` which fades it
 */
export default function CrossHair() {
  const w = useContext(WorldContext);
  return (
    <mesh
      ref={w.view.ref("zoomCrossEl")}
      visible={false}
      renderOrder={10}
      geometry={groundCrosshairGeometry}
      position={[0, crosshairY, 0]}
    >
      <meshBasicMaterial color="white" transparent depthTest={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

const groundCrosshairGeometry = createGroundCrosshairGeometry();
