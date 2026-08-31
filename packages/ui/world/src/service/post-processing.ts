import { Fn, float, mix, select, smoothstep, uniform, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { SelectAnyType } from "./texture";

export type PostProcessing = {
  /**
   * Changes whenever this is rebuilt. The pipeline captures the node graph when it is made, so it
   * must be made again when this changes — put it in the deps that build it, and an hmr of this
   * file reaches the screen. See `WorldView`'s `reset`
   */
  uid: string;
  /**
   * The two the frame is composed between, from `theme.post`: `lightBg` where nothing at all was
   * drawn, `darkBg` behind everything that was. Uniforms, so a change of theme is a pair of values
   * written rather than the pipeline rebuilt.
   *
   * What a room out of view comes to, as well — the page in `"map"` mode and the dark in
   * `"focus"`, so a hidden room is either a floorplan or simply not there. See `Floor`
   */
  lightBg: THREE.UniformNode<"color", THREE.Color>;
  darkBg: THREE.UniformNode<"color", THREE.Color>;
  /**
   * What reaches the canvas.
   * @param sceneColor the pass's `output`
   * @param focus `1` in `"focus"` mode and `0` in the others — see `service/fade-rooms`
   */
  apply(sceneColor: THREE.TextureNode, focus: THREE.Node<"float">): THREE.Node<"vec4">;
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
  const lightBg = uniform(new THREE.Color(defaultLightBg));
  const darkBg = uniform(new THREE.Color(defaultDarkBg));

  return {
    uid: crypto.randomUUID(),
    lightBg,
    darkBg,

    apply(sceneColor, focus) {
      return Fn(() => {
        // What lies BEHIND the world at this pixel: the dark wherever anything at all was drawn,
        // even a door at part coverage, so every silhouette gets its own dark edge. BEYOND the
        // world it is the page in `"map"` mode, which the ship then reads as a floorplan on — and
        // the dark in `"focus"`, where what the player cannot see is not there and the space
        // around the world is no different from it
        const beyond = mix(lightBg, darkBg, focus);
        const backdrop = (select as SelectAnyType)(sceneColor.a.greaterThan(0), darkBg, beyond) as THREE.Node<
          "color" | "vec3"
        >;

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

/** Until a theme says otherwise — see `theme.post` */
const defaultLightBg = "#ffffff";
const defaultDarkBg = "#000000";
