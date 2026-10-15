import { useFrame } from "@react-three/fiber";
import { useContext, useRef } from "react";
import * as THREE from "three/webgpu";
import { crosshairY } from "../const.env";
import { createGroundCrosshairGeometry } from "../service/geometry";
import { WorldContext } from "./world-context";

/** Where a tap has the player look: a cross on the floor there — see `w.player.lookTowards`. Whilst "view pick", where the last pick landed */
export default function LookMark() {
  const w = useContext(WorldContext);
  const cross = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (cross.current === null) return;
    const npc = w.player.get();
    const { pickedAt } = w.view;
    const at = w.view.objectPick.value === 1 ? pickedAt && { x: pickedAt.x, y: pickedAt.z } : w.player.lookAt;
    cross.current.visible = npc !== undefined && at !== null;
    if (npc !== undefined && at !== null) cross.current.position.set(at.x, npc.position.y + crosshairY, at.y);
  });

  return (
    // straight after the floor and obstacles (`-3`), so all else draws over it
    <mesh
      ref={(mesh) => void (cross.current = w.view.lookMark = mesh)}
      visible={false}
      renderOrder={-2.5}
      geometry={crossGeometry}
    >
      <meshBasicMaterial
        color="white"
        opacity={0.5}
        transparent
        depthTest
        depthWrite={false}
        side={THREE.DoubleSide}
        forceSinglePass
      />
    </mesh>
  );
}

const crossGeometry = createGroundCrosshairGeometry();
