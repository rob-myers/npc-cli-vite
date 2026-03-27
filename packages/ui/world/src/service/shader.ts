import { checker, color, float, instancedArray, instanceIndex, positionLocal, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";

export function createCheckerBoxMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial();
  const uv = positionLocal.xz.mul(float(16));
  const check = checker(uv);
  mat.colorNode = check.mix(color(0x222222), color(0xcccccc));
  return mat;
}

export function createInstancedTransparentMaterial(instanceCount: number, opacity = 0.5) {
  const colorsBuffer = instancedArray(instanceCount, "vec4");
  const colorData = colorsBuffer.value.array as Float32Array;
  for (let i = 0; i < instanceCount; i++) {
    colorData[i * 4 + 3] = opacity; // invisible partial transparency
  }

  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
    transparent: true,
  });
  const instanceColor = colorsBuffer.element(instanceIndex);
  material.colorNode = vec4(instanceColor.x, instanceColor.y, instanceColor.z, 1.0);
  material.opacityNode = instanceColor.w;

  return { material, colorsBuffer };
}
