import { bleach } from "three/examples/jsm/tsl/display/BleachBypass.js";
import { barrelUV, scanlines, vignette } from "three/examples/jsm/tsl/display/CRT.js";
import { dotScreen } from "three/examples/jsm/tsl/display/DotScreenNode.js";
import { film } from "three/examples/jsm/tsl/display/FilmNode.js";
import { sepia } from "three/examples/jsm/tsl/display/Sepia.js";
import {
  clamp,
  colorSpaceToWorking,
  convertToTexture,
  float,
  floor,
  fract,
  luminance,
  mix,
  rand,
  smoothstep,
  step,
  time,
  uv,
  vec3,
  vec4,
  workingToColorSpace,
} from "three/tsl";
import * as THREE from "three/webgpu";

/** In menu order */
export const extraFxKeys = [
  "dot-screen",
  "mono",
  "sepia",
  "bleach",
  "film",
  "night-vision",
  "thermal",
  "crt",
  "noir",
  "duotone",
  "cyanotype",
  "cross-process",
  "gameboy",
] as const;

export type ExtraFxKey = (typeof extraFxKeys)[number];

export const parseExtraFxKey = (key: unknown): ExtraFxKey =>
  extraFxKeys.includes(key as ExtraFxKey) ? (key as ExtraFxKey) : extraFxKeys[0];

export type ExtraFx = {
  /** Changes on rebuild, so an hmr of this file reaches the pipeline */
  uid: string;
  /** @param composed the opaque finished frame, in linear working space */
  apply(composed: THREE.Node, enabled: boolean, key: ExtraFxKey): THREE.Node;
};

/**
 * Stock or cheap effects to try on the finished frame, picked from the debug menu.
 * Each sees display values, since they were written against them.
 */
export function createExtraFx(): ExtraFx {
  return {
    uid: crypto.randomUUID(),

    apply(composed, enabled, key) {
      if (enabled === false) {
        return composed;
      }
      const display = asVec4(workingToColorSpace(composed, THREE.SRGBColorSpace));
      return colorSpaceToWorking(styleFrame(display, key), THREE.SRGBColorSpace);
    },
  };
}

/**
 * Where on the frame the screen point `u, v` was drawn from, or `null` if off it.
 * Only `"crt"` moves it. Mirrors `barrelUV`, so the two change together.
 */
export function warpExtraFxUv(key: ExtraFxKey, u: number, v: number): null | { u: number; v: number } {
  if (key !== "crt") {
    return { u, v };
  }
  const cx = (u - 0.5) * 2;
  const cy = (v - 0.5) * 2;
  const scale = ((1 - crtCurvature * 2) * 0.5) / (1 - (cx * cx + cy * cy) * crtCurvature);
  const warped = { u: cx * scale + 0.5, v: cy * scale + 0.5 };
  return warped.u < 0 || warped.u > 1 || warped.v < 0 || warped.v > 1 ? null : warped;
}

/** The stock effects are typed as bare `Node`s, which carry none of the operators */
const asVec4 = (node: THREE.Node) => node as unknown as THREE.Node<"vec4">;

/** Luminance scaled by `gain`, clamped to `[0, 1]` */
const lift = (display: THREE.Node<"vec4">, gain: number) => clamp(luminance(display.rgb).mul(gain), 0, 1);

/** Blends along `colors` as `t` goes from `0` to `1` */
function ramp(t: THREE.Node<"float">, colors: THREE.Node<"vec3">[]) {
  const scaled = t.mul(colors.length - 1);
  let color = colors[0];
  for (let i = 1; i < colors.length; i++) {
    color = mix(color, colors[i], clamp(scaled.sub(i - 1), 0, 1));
  }
  return color;
}

/** @param display the frame in display values */
function styleFrame(display: THREE.Node<"vec4">, key: ExtraFxKey): THREE.Node {
  switch (key) {
    case "dot-screen":
      return dotScreen(display, dotScreenAngle, dotScreenScale);
    case "mono":
      return vec4(vec3(luminance(display.rgb)), 1);
    case "sepia":
      return sepia(display);
    case "bleach": {
      // lifted to meet `bleach`'s pivot of 0.45, then blended back to the real frame
      const bleached = asVec4(bleach(display.mul(bleachGain), 1));
      return mix(display, bleached, bleachStrength);
    }
    case "film": {
      // `film` only adds, so `filmGain` takes its lift back out
      const grained = asVec4(film(display, float(filmIntensity)));
      return grained.mul(filmGain);
    }
    case "night-vision": {
      const lum = lift(display, nightGain);
      const grain = rand(uv().add(fract(time)))
        .sub(0.5)
        .mul(nightGrain);
      const lit = nightTint.mul(lum.add(grain));
      return vec4(vignette(lit, float(nightVignette), float(0.5)), 1);
    }
    case "thermal":
      return vec4(ramp(lift(display, thermalGain), thermalRamp), 1);
    case "crt": {
      const tex = convertToTexture(display);
      const coord = barrelUV(float(crtCurvature));
      const lined = scanlines(tex.sample(coord).rgb, float(crtScanlines), float(crtScanlineCount), float(0), coord);
      const lit = vignette(lined, float(crtVignette), float(crtVignetteSmoothness), coord);
      // the corners pushed off-frame
      const inFrame = step(0, coord.x).mul(step(coord.x, 1)).mul(step(0, coord.y)).mul(step(coord.y, 1));
      return vec4(lit.mul(inFrame), 1);
    }
    case "noir": {
      const lum = smoothstep(noirLow, noirHigh, lift(display, noirGain));
      return vec4(vignette(vec3(lum), float(noirVignette), float(0.5)), 1);
    }
    case "duotone":
      return vec4(ramp(lift(display, duotoneGain), duotoneRamp), 1);
    case "cyanotype":
      return vec4(ramp(lift(display, cyanotypeGain), cyanotypeRamp), 1);
    case "cross-process": {
      // red and green take an s-curve, blue is flattened and lifted
      const c = display.rgb;
      return vec4(smoothstep(0, 1, c.r), smoothstep(0.05, 0.95, c.g), c.b.mul(0.6).add(0.2), 1);
    }
    case "gameboy": {
      // four shades, with no blend between them
      const shade = floor(lift(display, gameboyGain).mul(3.99)).div(3);
      return vec4(ramp(shade, gameboyRamp), 1);
    }
  }
}

/** Radians, and how small the dots are: higher scale, smaller dots */
const dotScreenAngle = Math.PI / 2;
const dotScreenScale = 4.9;

const bleachGain = 1.4;
const bleachStrength = 0.7;

/** `1 / (1 + 0.55 * filmIntensity)` is neutral */
const filmIntensity = 0.5;
const filmGain = 0.58;

const nightGain = 2.5;
const nightGrain = 0.15;
const nightTint = vec3(0.35, 1, 0.4);
const nightVignette = 0.6;

const thermalGain = 1.8;
const thermalRamp = [vec3(0, 0, 0.1), vec3(0.3, 0, 0.6), vec3(0.85, 0.1, 0.3), vec3(1, 0.6, 0), vec3(1, 1, 0.8)];

const crtCurvature = 0.15;
const crtScanlines = 0.25;
const crtScanlineCount = 480;
const crtVignette = 5;
const crtVignetteSmoothness = 0.5;

const noirGain = 1.3;
const noirLow = 0.1;
const noirHigh = 0.85;
const noirVignette = 0.7;

const duotoneGain = 1.6;
const duotoneRamp = [vec3(0.16, 0.04, 0.3), vec3(1, 0.86, 0.45)];

const cyanotypeGain = 1.6;
const cyanotypeRamp = [vec3(0, 0.1, 0.28), vec3(0.85, 0.93, 1)];

const gameboyGain = 1.8;
const gameboyRamp = [vec3(0.06, 0.22, 0.06), vec3(0.19, 0.38, 0.19), vec3(0.55, 0.67, 0.06), vec3(0.61, 0.74, 0.06)];
