import { Fn, float, mix, screenSize, screenUV, smoothstep, step, vec3, vec4 } from "three/tsl";
import type * as THREE from "three/webgpu";

export type PostProcessing = {
  /**
   * Changes whenever this is rebuilt. The pipeline captures the node graph when it is made, so it
   * must be made again when this changes — put it in the deps that build it, and an hmr of this
   * file reaches the screen. See `WorldView`'s `reset`
   */
  uid: string;
  /**
   * What reaches the canvas.
   * @param sceneColor the pass's `output`
   */
  apply(sceneColor: THREE.TextureNode): THREE.Node<"vec4">;
};

/**
 * What the post pass does to the finished frame — kept apart from `WorldView`, which owns the
 * pipeline and the `gl.render` it hangs off, so an effect can be rewritten without touching any
 * of that.
 *
 * What it does is compose the frame over a striped backdrop — the page's own pattern, moved inside
 * the canvas so nothing shows through the doors that should not. That the pass decides is the
 * point: a door at 0.8 with nothing behind it reads as solid against the stripes, which its own
 * material could never arrange — it has no idea whether a room or the sky is behind it.
 *
 * What the world fades out INTO, in other words. The fading itself is `service/fade-rooms`' job and
 * happens per room, in the materials: a circle about the player used to do it here instead, but a
 * circle knows nothing about the walls and cut across the rooms it was hiding.
 */
export function createPostProcessing(): PostProcessing {
  return {
    uid: crypto.randomUUID(),

    apply(sceneColor) {
      return Fn(() => {
        // The backdrop: thin diagonal stripes, in DEVICE pixels rather than in the world, so they
        // stay a hairline whatever the camera does — the page's pattern, now inside the canvas
        const diagonal = screenUV.x.mul(screenSize.x).add(screenUV.y.mul(screenSize.y));
        const alongStripe = diagonal.mul(1 / stripePeriodPx).fract();
        const stripe = step(alongStripe, stripeWidthPx / stripePeriodPx).mul(stripeAlpha);
        const backdrop = mix(backdropColor, stripeColor, stripe);

        // Coverage counts for MORE than it is, so a door at `defaultDoorOpacity` reads solid
        // against the backdrop and gives way only as the world dissolves it. Smoothstep rather than
        // a step, to keep silhouettes MSAA resolved into partial alpha from turning ragged.
        //
        // It saturates just short of full rather than at half: a room fading out under
        // `service/fade-rooms` would otherwise be pinned solid for the first half of its fade and
        // then drop away all at once, which reads as a snap rather than a fade
        const drawn = smoothstep(float(0), float(coverageFull), sceneColor.a);

        // What the world amounts to at this pixel, PREMULTIPLIED — colour already scaled by the
        // coverage beside it, which is what makes the composite a plain sum rather than a `mix`
        const composed = backdrop.mul(drawn.oneMinus()).add(sceneColor.rgb.mul(drawn));

        return vec4(composed, 1);
      })();
    },
  };
}

/** The coverage a fragment must carry to count as fully drawn — see `drawn` */
const coverageFull = 0.85;

/** What lies beyond the world: near-black, ruled with hairline diagonals */
// const backdropColor = vec3(0.0, 0.0, 0.0);
// const backdropColor = vec3(1.0, 0.0, 0.0);
const backdropColor = vec3(0.006, 0.006, 0.006);

// const stripeColor = vec3(0.3, 0.22, 0.22);
const stripeColor = vec3(0, 0, 0);
const stripeAlpha = 0.05;
/** Both in device pixels, measured ALONG the diagonal — so the gap between stripes is `1 / √2` of it */
const stripePeriodPx = 16;
const stripeWidthPx = 1.5;
