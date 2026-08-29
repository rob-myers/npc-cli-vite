import {
  Fn,
  float,
  getViewPosition,
  mix,
  screenSize,
  screenUV,
  smoothstep,
  step,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { FadeRooms } from "./fade-rooms";

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
  /**
   * @param rooms when given, their outlines are drawn over the finished frame whilst its own
   * debug option is on — see `service/fade-rooms`
   */
  apply(sceneColor: THREE.TextureNode, rooms?: FadeRooms): THREE.Node<"vec4">;
  /** The camera the frame was drawn with, which the outlines are placed against. Call every frame */
  update(camera: THREE.Camera): void;
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
  // to turn a pixel back into a view ray
  const camProjectionMatrixInverse = uniform(new THREE.Matrix4());
  const camWorldMatrix = uniform(new THREE.Matrix4());
  return {
    uid: crypto.randomUUID(),

    update(camera) {
      camera.updateMatrixWorld(); // so it is this frame's, not the last one's
      camProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      camWorldMatrix.value.copy(camera.matrixWorld);
    },

    apply(sceneColor, rooms) {
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

        if (rooms === undefined) return vec4(composed, 1);

        // debug: the outlines of the rooms in view, laid OVER the finished frame rather than into
        // the world, so they read wherever they fall.
        //
        // The camera is the origin in view space, so a point on the ray IS its direction; where it
        // meets the ground is where this pixel counts as standing. No depth buffer needed, which
        // suits a floor that does not write one (it would z-fight in the hull doorways). The camera
        // looks down, so `y` is negative — the cap keeps a ray along the horizon far away rather
        // than sending it up behind us
        const onRay = getViewPosition(screenUV, float(1), camProjectionMatrixInverse);
        const rayDir = camWorldMatrix.mul(vec4(onRay, 0)).xyz;
        const camPos = camWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz;
        const worldXZ = camPos.xz.add(rayDir.xz.mul(camPos.y.div(rayDir.y.min(-1e-4).negate())));

        const onEdge = smoothstep(float(roomEdgeWidth), float(0), rooms.distanceAt(worldXZ));
        return vec4(mix(composed, roomEdgeColor, onEdge), 1);
      })();
    },
  };
}

/** The coverage a fragment must carry to count as fully drawn — see `drawn` */
const coverageFull = 0.85;

/** debug: the room outlines — how wide the line is, in metres, and its ink */
const roomEdgeWidth = 0.06;
const roomEdgeColor = /* @__PURE__ */ vec3(1, 0.1, 0.1);

/** What lies beyond the world: near-black, ruled with hairline diagonals */
const backdropColor = vec3(0.0, 0.0, 0.0);
// const backdropColor = vec3(1.0, 0.0, 0.0);

const stripeColor = vec3(0.3, 0.22, 0.22);
const stripeAlpha = 0.05;
/** Both in device pixels, measured ALONG the diagonal — so the gap between stripes is `1 / √2` of it */
const stripePeriodPx = 16;
const stripeWidthPx = 1.5;
