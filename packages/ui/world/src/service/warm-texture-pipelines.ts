import * as THREE from "three/webgpu";

/**
 * Uploads small textures so the GPU compiles its texture pipelines now: Dawn's image copy and three's mipmaps.
 * On a cold GPU each stops every frame, which is better paid before anything animates.
 */
export function warmTexturePipelines(renderer: THREE.WebGPURenderer) {
  // smaller, Chrome draws the canvas in software and uploads it from the CPU
  const canvas = Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
  canvas.getContext("2d")?.fillRect(0, 0, 1, 1);
  for (const colorSpace of [THREE.SRGBColorSpace, THREE.NoColorSpace]) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.generateMipmaps = false;
    tex.colorSpace = colorSpace;
    renderer.initTexture(tex);
    tex.dispose();

    // as an anisotropic `TexArray`, e.g. the floor's
    const array = new THREE.DataArrayTexture(new Uint8Array(2 * 2 * 4), 2, 2, 1);
    array.colorSpace = colorSpace;
    array.magFilter = THREE.LinearFilter;
    array.minFilter = THREE.LinearMipmapLinearFilter;
    array.generateMipmaps = true;
    array.needsUpdate = true;
    renderer.initTexture(array);
    array.dispose();
  }
}
