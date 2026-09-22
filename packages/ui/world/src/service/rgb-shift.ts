import { rgbShift } from "three/examples/jsm/tsl/display/RGBShiftNode.js";
import { colorSpaceToWorking, workingToColorSpace } from "three/tsl";
import * as THREE from "three/webgpu";

export type RgbShiftFx = {
  /**
   * Changes whenever this is rebuilt — same reason as `PostProcessing`'s own `uid`: the pipeline
   * captures the node graph when it is made, so an hmr of this file only reaches the screen if
   * something in `PostProcessing`'s deps moved. See `WorldView`'s `reset`
   */
  uid: string;
  /** How far the channels part, in uv: eased down as the view zooms out — see `WorldView`'s `onCameraFrame` */
  setAmount(amount: number): void;
  /**
   * @param composed what `PostProcessing.apply` produced — OPAQUE, with the theme's backdrop
   * already under the world: a full-frame restyle with no notion of what was drawn and what wasn't
   */
  apply(composed: THREE.Node<"vec4">, enabled: boolean): THREE.Node;
};

/**
 * The channels parted slightly, over the finished frame. Toggled from the debug menu.
 * It samples its neighbours, so `rgbShift` renders the frame into a render target first — inside
 * `pipeline.render()`, where `WorldView`'s `gl.render` patch is already re-entrant.
 */
export function createRgbShift(): RgbShiftFx {
  // the effect keeps its own uniform, so the amount is written onto whichever node is built
  let node: null | { amount: { value: number } } = null;
  let amount = rgbShiftAmount;

  return {
    uid: crypto.randomUUID(),

    setAmount(next) {
      amount = next;
      if (node !== null) node.amount.value = next;
    },

    apply(composed, enabled) {
      if (enabled === false) {
        return composed;
      }
      // What reaches `outputNode` is still in the renderer's LINEAR working space — the sRGB
      // encode is the pipeline's own last step — whilst the effect was written against DISPLAY
      // values. So it is handed a display-referred frame and the result decoded back for the
      // pipeline to encode again
      const display = workingToColorSpace(composed, THREE.SRGBColorSpace) as unknown as THREE.Node<"vec4">;
      node = rgbShift(display, amount, rgbShiftAngle) as unknown as { amount: { value: number } };
      return colorSpaceToWorking(node as unknown as THREE.Node<"vec4">, THREE.SRGBColorSpace);
    },
  };
}

/** How far the channels part close in, in uv, and along which direction */
export const rgbShiftAmount = 0.0025;
const rgbShiftAngle = 0;
