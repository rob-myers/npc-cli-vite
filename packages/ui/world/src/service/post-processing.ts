import { Fn, float, smoothstep, uniform, vec3, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";

export type PostProcessing = {
  /**
   * Changes whenever this is rebuilt. The pipeline captures the node graph when it is made, so it
   * must be made again when this changes — put it in the deps that build it, and an hmr of this
   * file reaches the screen. See `WorldView`'s `reset`
   */
  uid: string;
  /**
   * What lies beyond the world, from `theme.post.background`. A uniform, so a change of theme is a
   * value written rather than the pipeline rebuilt
   */
  background: THREE.UniformNode<"color", THREE.Color>;
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
 * What it does is put BLACK behind everything the frame drew — a door at part coverage included —
 * and the theme's background everywhere else, then compose the frame over that. So the world reads
 * as a silhouette on the page, and a door at 0.8 with nothing behind it comes out solid, which its
 * own material could never arrange: it has no idea whether a room or the sky is behind it.
 *
 * What the world fades out INTO, in other words. The fading itself is `service/fade-rooms`' job and
 * happens per room, in the materials: a circle about the player used to do it here instead, but a
 * circle knows nothing about the walls and cut across the rooms it was hiding.
 */
export function createPostProcessing(): PostProcessing {
  const background = uniform(new THREE.Color(defaultBackground));

  return {
    uid: crypto.randomUUID(),
    background,

    apply(sceneColor) {
      return Fn(() => {
        // What lies BEHIND the world at this pixel: black wherever anything at all was drawn, even
        // a door at part coverage, and the theme's own colour where nothing was. Every silhouette
        // gets its own dark edge, and what the world fades out into is the page
        const backdrop = sceneColor.a.greaterThan(0).select(vec3(0), background);

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

/** Until a theme says otherwise — see `theme.post.background` */
const defaultBackground = "#ffffff";
