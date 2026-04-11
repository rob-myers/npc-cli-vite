import { hashJson, warn } from "@npc-cli/util/legacy/generic";
import * as THREE from "three";

interface TexArrayOpts {
  numTextures: number;
  /** Minimum `1` */
  width: number;
  /** Minimum `1` */
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
  hash = 0;

  constructor(opts: TexArrayOpts) {
    if (opts.numTextures === 0) {
      throw Error(`${"TexArray"}: numTextures cannot be 0`);
    }

    this.opts = opts;
    this.ct = getContext2d(opts.ctKey, { willReadFrequently: true });

    // 🔔 avoid overwrite named canvas dimensions via `opts.width === opts.height === 1`
    // - can happen during hot-reload of World useStateRef
    this.ct.canvas.width = opts.width === 1 ? this.ct.canvas.width || 1 : opts.width;
    this.ct.canvas.height = opts.height === 1 ? this.ct.canvas.height || 1 : opts.height;

    const data =
      opts.type === THREE.FloatType
        ? new Float32Array(opts.numTextures * 4 * opts.width * opts.height)
        : new Uint8Array(opts.numTextures * 4 * opts.width * opts.height);
    this.tex = new THREE.DataArrayTexture(data, opts.width, opts.height, opts.numTextures);
    this.tex.format = THREE.RGBAFormat;
    this.tex.type = opts.type ?? THREE.UnsignedByteType;

    this.hash = hashJson(opts);
  }

  dispose() {
    // We don't `this.ct.canvas.{width,height} = 0`,
    // because context is cached under `opts.ctKey`.
    this.tex.dispose();
  }

  /**
   * - Resize if needed i.e. if "dimension" or "number of textures" has changed.
   * - This recreates `THREE.DataArrayTexture`.
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

    // 🚧
    warn("resizing texture array", this.opts.ctKey, {
      width: opts.width,
      height: opts.height,
      numTextures: opts.numTextures,
    });

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
    this.tex.colorSpace = THREE.NoColorSpace;

    this.hash = hashJson(opts);
  }

  update() {
    for (let i = 0; i < this.opts.numTextures; i++) {
      this.tex.addLayerUpdate(i); // fix double draw on Cmd+Shift+T in Chrome
    }
    this.tex.needsUpdate = true;
  }

  updateIndex(index: number, data?: Uint8Array | Float32Array, rowOffset = 0) {
    const offset = index * (4 * this.opts.width * this.opts.height) + rowOffset * 4 * this.opts.width;
    const imageData = data ?? this.ct.getImageData(0, 0, this.opts.width, this.opts.height).data;
    (this.tex.image.data as Uint8Array | Float32Array).set(imageData, offset);

    // three.js clears these layers after next render
    this.tex.addLayerUpdate(index);
    // 🚧 we're marking the ones this update applies to in previous line
    this.tex.needsUpdate = true;
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
