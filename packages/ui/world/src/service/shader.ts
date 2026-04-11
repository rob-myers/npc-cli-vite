import { checker, color, float, positionLocal } from "three/tsl";
import * as THREE from "three/webgpu";

export function createCheckerBoxMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial();
  const uv = positionLocal.xz.mul(float(16));
  const check = checker(uv);
  mat.colorNode = check.mix(color(0x222222), color(0xcccccc));
  return mat;
}
