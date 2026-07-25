import { Fn, float, If, vec3 } from "three/tsl";
import type * as THREE from "three/webgpu";
import type { DynamicLightPostprocess } from "./dynamic-light";

export type EdgeContourEffectOpts = {
  /** litOut value the contour is centred on. Default `0.75`. */
  isoValue?: number;
  /** Half-width of the band around `isoValue` that's considered "on the edge". Default `0.4`. */
  edgeBand?: number;
  /** Max opacity at the outer (far-from-light) half of the band. Default `0.05`. */
  maxAlpha?: number;
  /** Contour colour. Default cyan `(0, 1, 1)`. */
  color?: [number, number, number];
};

export type EdgeContourEffect = {
  color: THREE.Node<"vec3">;
  /** Blend amount in [0,1] for `color` — a thin band around `isoValue`. Raymarch is skipped on the GPU when `themeAmount` is `0` (uniform, so the `If` compiles to a real branch). */
  amount(
    dynamicLight: Pick<DynamicLightPostprocess, "groundLitAmount">,
    sceneDepth: THREE.Node<"float">,
    themeAmount: THREE.Node<"float">,
  ): THREE.Node<"float">;
};

/** "Splinter Cell" style glowing contour tracing the boundary of `dynamicLight`'s reach. */
export function createEdgeContourEffect(opts: EdgeContourEffectOpts = {}): EdgeContourEffect {
  const isoValue = opts.isoValue ?? 0.75;
  const edgeBand = opts.edgeBand ?? 0.4;
  const maxAlpha = opts.maxAlpha ?? 0.05;
  const color = vec3(...(opts.color ?? [0, 1, 1]));

  return {
    color,
    amount(dynamicLight, sceneDepth, themeAmount) {
      return Fn(() => {
        const out = float(0).toVar();
        If(themeAmount.greaterThan(0), () => {
          const groundLitAmount = dynamicLight.groundLitAmount(sceneDepth);
          const edgeAmount = float(1).sub(groundLitAmount.sub(isoValue).abs().div(edgeBand).clamp(0, 1));
          // litOut falls with distance, so lower-within-band = farther from the light
          const distAlpha = float(1).sub(groundLitAmount.sub(isoValue).div(edgeBand).clamp(-1, 1)).mul(maxAlpha);
          out.assign(edgeAmount.mul(distAlpha).mul(themeAmount));
        });
        return out;
      })();
    },
  };
}
