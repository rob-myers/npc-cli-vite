import * as THREE from "three";

interface TexArrayOpts {
  numTextures: number;
  width: number;
  height: number;
  /** key for cached canvas context */
  ctKey: string;
  type?: typeof THREE.UnsignedByteType | typeof THREE.FloatType;
}

export interface TextureItem {
  tex: THREE.CanvasTexture;
  ct: CanvasRenderingContext2D;
}

/**
 * Based on:
 * https://discourse.threejs.org/t/how-can-i-color-the-plane-with-different-colors-as-squares-in-the-same-face/53418/8
 */
export class TexArray {
  opts: TexArrayOpts;
  ct: CanvasRenderingContext2D;
  tex: THREE.DataArrayTexture;

  constructor(opts: TexArrayOpts) {
    if (opts.numTextures === 0) {
      throw Error(`${"TexArray"}: numTextures cannot be 0`);
    }

    this.opts = opts;
    this.ct = getContext2d(opts.ctKey, { willReadFrequently: true });
    this.ct.canvas.width = opts.width;
    this.ct.canvas.height = opts.height;

    const data =
      opts.type === THREE.FloatType
        ? new Float32Array(opts.numTextures * 4 * opts.width * opts.height)
        : new Uint8Array(opts.numTextures * 4 * opts.width * opts.height);
    this.tex = new THREE.DataArrayTexture(data, opts.width, opts.height, opts.numTextures);
    this.tex.format = THREE.RGBAFormat;
    this.tex.type = opts.type ?? THREE.UnsignedByteType;
  }

  dispose() {
    // We don't `this.ct.canvas.{width,height} = 0`,
    // because context is cached under `opts.ctKey`.
    this.tex.dispose();
  }

  /**
   * Resize if needed i.e. if "dimension" or "number of textures" has changed.
   */
  resize(opts: Omit<TexArrayOpts, "ctKey">) {
    if (
      this.ct.canvas.width !== 0 &&
      opts.width === this.opts.width &&
      opts.height === this.opts.height &&
      opts.numTextures === this.opts.numTextures
    ) {
      return; // resize not needed
    }

    Object.assign(this.opts, opts);

    this.ct.canvas.width = opts.width;
    this.ct.canvas.height = opts.height;

    this.tex.dispose();

    const data =
      opts.type === THREE.FloatType
        ? new Float32Array(opts.numTextures * 4 * opts.width * opts.height)
        : new Uint8Array(opts.numTextures * 4 * opts.width * opts.height);
    this.tex = new THREE.DataArrayTexture(data, opts.width, opts.height, opts.numTextures);
    this.tex.format = THREE.RGBAFormat;
    this.tex.type = opts.type ?? THREE.UnsignedByteType;
  }

  update() {
    this.tex.needsUpdate = true;
  }

  updateIndex(index: number, data?: Uint8Array | Float32Array, rowOffset = 0) {
    const offset = index * (4 * this.opts.width * this.opts.height) + rowOffset * 4 * this.opts.width;
    const imageData = data ?? this.ct.getImageData(0, 0, this.opts.width, this.opts.height).data;
    (this.tex.image.data as Uint8Array | Float32Array).set(imageData, offset);

    // three.js clears these layers after next render
    this.tex.addLayerUpdate(index);
    this.tex.needsUpdate = true; // 🚧
  }
}

/** Browser only i.e. `document.createElement` */
export function getContext2d(
  key: string,
  opts?: CanvasRenderingContext2DSettings & { width?: number; height?: number },
) {
  const canvas = (canvasLookup[key] ??= document.createElement("canvas"));
  if (opts?.width) canvas.width = opts.width;
  if (opts?.height) canvas.height = opts.height;
  return canvas.getContext("2d", opts) as CanvasRenderingContext2D;
}

/** Cache to avoid re-creation on HMR */
const canvasLookup: Record<string, HTMLCanvasElement> = {};

export const emptyTexArray = new TexArray({ ctKey: "empty", width: 0, height: 0, numTextures: 1 });
