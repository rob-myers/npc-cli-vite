import { bleach } from "three/examples/jsm/tsl/display/BleachBypass.js";
import { barrelUV, vignette } from "three/examples/jsm/tsl/display/CRT.js";
import { dotScreen } from "three/examples/jsm/tsl/display/DotScreenNode.js";
import { film } from "three/examples/jsm/tsl/display/FilmNode.js";
import { rgbShift } from "three/examples/jsm/tsl/display/RGBShiftNode.js";
import { sepia } from "three/examples/jsm/tsl/display/Sepia.js";
import { sobel } from "three/examples/jsm/tsl/display/SobelOperatorNode.js";
import { colorSpaceToWorking, convertToTexture, float, mix, step, vec4, workingToColorSpace } from "three/tsl";
import * as THREE from "three/webgpu";

/** In menu order — `"none"` first, so the select starts where nothing is happening */
export const demoPostFxKeys = ["none", "sobel", "dot-screen", "rgb-shift", "sepia", "bleach", "film", "crt"] as const;

export type DemoPostFxKey = (typeof demoPostFxKeys)[number];

export type DemoPostFx = {
  /**
   * Changes whenever this is rebuilt — same reason as `PostProcessing`'s own `uid`: the pipeline
   * captures the node graph when it is made, so an hmr of this file only reaches the screen if
   * something in `PostProcessing`'s deps moved. See `WorldView`'s `reset`
   */
  uid: string;
  /**
   * @param composed what `PostProcessing.apply` produced — OPAQUE, with the theme's backdrop
   * already under the world. Every effect here wants that: they are full-frame restyles with no
   * notion of what was drawn and what wasn't
   */
  apply(composed: THREE.Node<"vec4">, key: DemoPostFxKey): THREE.Node;
};

/**
 * A shelf of stock three.js effects to try on the finished frame, picked from the debug menu.
 * Nothing here is load-bearing — it is somewhere to see what an effect does to this world before
 * deciding whether it belongs in `service/post-processing` for real.
 *
 * They come in two shapes and both chain onto a plain node: the colour-in/colour-out ones
 * (`sepia`, `bleach`, `dotScreen`, `film`) read the fragment they are given, whilst the rest call
 * `convertToTexture` internally because they sample their neighbours — which renders the frame
 * into a render target first. That happens inside `pipeline.render()`, where `WorldView`'s
 * `gl.render` patch is already re-entrant, so it needs nothing from us.
 */
export function createDemoPostFx(): DemoPostFx {
  return {
    uid: crypto.randomUUID(),

    apply(composed, key) {
      if (key === "none") {
        return composed;
      }

      // What reaches `outputNode` is still in the renderer's LINEAR working space — the sRGB
      // encode is the pipeline's own last step. Every effect below was written against DISPLAY
      // values, and the difference is not cosmetic: `bleach` pivots at a luminance of 0.45 and
      // `dotScreen` ramps `10x - 5`, so a mid grey arriving as 0.21 rather than 0.5 puts both of
      // them off the bottom of their range and the whole frame comes out black.
      //
      // So they are handed a display-referred frame and the result is decoded back for the
      // pipeline to encode again. A round trip of the transfer function, which costs a pair of
      // `pow`s and keeps this file to itself
      const display = asVec4(workingToColorSpace(composed, THREE.SRGBColorSpace));
      return colorSpaceToWorking(styleFrame(display, key), THREE.SRGBColorSpace);
    },
  };
}

/**
 * Where on the FRAME the screen point `u, v` landed under `"crt"`, or `null` when it landed off it.
 * The effect samples the frame through `barrelUV`, so what you see at a pixel was drawn somewhere
 * else — and object picking renders its own UNDISTORTED crop of the scene, which without this
 * drifts further from what is on screen the nearer the edge you click.
 *
 * Mirrors `barrelUV` on the cpu, so the two have to change together.
 */
export function warpCrtUv(u: number, v: number): null | { u: number; v: number } {
  const cx = (u - 0.5) * 2;
  const cy = (v - 0.5) * 2;
  // push outward by the distance from centre, then take the corner expansion back out
  const scale = ((1 - crtCurvature * 2) * 0.5) / (1 - (cx * cx + cy * cy) * crtCurvature);
  const warped = { u: cx * scale + 0.5, v: cy * scale + 0.5 };

  // the corners the bulge pushes off-frame, which `inFrame` masks to black
  return warped.u < 0 || warped.u > 1 || warped.v < 0 || warped.v > 1 ? null : warped;
}

/** The nodes here are typed as bare `Node`s, which carry none of the operators */
const asVec4 = (node: THREE.Node) => node as unknown as THREE.Node<"vec4">;

/** @param display the frame in DISPLAY values, not the linear ones `outputNode` deals in */
function styleFrame(display: THREE.Node<"vec4">, key: Exclude<DemoPostFxKey, "none">): THREE.Node {
  switch (key) {
    case "sobel":
      // edges only: the ship comes out as a wireframe of itself
      return sobel(display);
    case "dot-screen":
      return dotScreen(display, dotScreenAngle, dotScreenScale);
    case "rgb-shift":
      return rgbShift(display, rgbShiftAmount, rgbShiftAngle);
    case "sepia":
      return sepia(display);
    case "bleach": {
      // `bleach` pivots at a luminance of 0.45 and this world sits well under it, so nearly every
      // pixel takes its darkening branch. `bleachGain` lifts the frame to meet the pivot; the
      // blend back is ours rather than the effect's `opacity`, which would blend towards the
      // lifted frame instead of the real one
      const bleached = asVec4(bleach(display.mul(bleachGain), 1));
      return mix(display, bleached, bleachStrength);
    }
    case "film": {
      // three's `film` only ever ADDS: `base + base * clamp(noise + 0.1, 0, 1)`, so the grain
      // arrives as a mean multiplier of roughly `1 + 0.55 * filmIntensity` and the whole frame
      // comes out lifted. `filmGain` takes that exposure back out and leaves the grain
      const grained = asVec4(film(display, float(filmIntensity)));
      return grained.mul(filmGain);
    }
    case "crt": {
      // the frame is resampled through `barrelUV`, so it reads as though it were painted onto the
      // front of a tube, and the vignette closes the edges in around it
      const tex = convertToTexture(display);
      const coord = barrelUV(float(crtCurvature));
      // the corners the bulge pushes off-frame, which would otherwise smear the edge texel
      const inFrame = step(float(0), coord.x)
        .mul(step(coord.x, float(1)))
        .mul(step(float(0), coord.y))
        .mul(step(coord.y, float(1)));
      // vignetted on the BARREL coord rather than the screen's, so the darkening curves with the
      // tube instead of sitting flat over it
      const lit = vignette(tex.sample(coord).rgb, float(crtVignette), float(crtVignetteSmoothness), coord);
      return vec4(lit.mul(inFrame), 1);
    }
  }
}

/** Radians, and how small the dots are — higher scale, smaller dots */
const dotScreenAngle = Math.PI / 2;
const dotScreenScale = 4.9;

/** How far the channels part, in uv, and along which direction */
const rgbShiftAmount = 0.0025;
const rgbShiftAngle = 0;

/** Where the frame sits against `bleach`'s pivot, and how much of the result is kept */
const bleachGain = 1.4;
const bleachStrength = 0.7;

/** How much grain, and the gain that undoes its lift — `1 / (1 + 0.55 * filmIntensity)` is neutral */
const filmIntensity = 0.5;
const filmGain = 0.58;

/** How far the screen bulges, and how far — and how gently — its edges are closed in */
const crtCurvature = 0.15;
const crtVignette = 5;
const crtVignetteSmoothness = 0.5;
