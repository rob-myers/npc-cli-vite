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
  return {
    uid: crypto.randomUUID(),

    apply(composed, enabled) {
      if (enabled === false) {
        return composed;
      }
      // What reaches `outputNode` is still in the renderer's LINEAR working space — the sRGB
      // encode is the pipeline's own last step — whilst the effect was written against DISPLAY
      // values. So it is handed a display-referred frame and the result decoded back for the
      // pipeline to encode again
      const display = workingToColorSpace(composed, THREE.SRGBColorSpace) as unknown as THREE.Node<"vec4">;
      return colorSpaceToWorking(rgbShift(display, rgbShiftAmount, rgbShiftAngle), THREE.SRGBColorSpace);
    },
  };
}

/** How far the channels part, in uv, and along which direction */
const rgbShiftAmount = 0.0025;
const rgbShiftAngle = 0;
