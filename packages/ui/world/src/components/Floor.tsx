import { Box } from "@react-three/drei";
import { useMemo } from "react";
import { checker, color, float, positionLocal } from "three/tsl";
import * as THREE from "three/webgpu";

export default function Floor() {
  const material = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial();
    const uv = positionLocal.xz.mul(float(16));
    const check = checker(uv);
    mat.colorNode = check.mix(color(0x222222), color(0xcccccc));
    return mat;
  }, []);

  return (
    <group>
      <Box args={[1, 1, 1, 10, 1, 10]} position={[0, 0, 0]} scale={[100, 0.001, 100]} material={material} />
    </group>
  );
}
