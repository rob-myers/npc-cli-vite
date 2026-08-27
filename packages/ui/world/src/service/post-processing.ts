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
   * @param rooms when given, their outlines are drawn over the finished frame whilst `enabled` —
   * see `service/fade-rooms`
   */
  apply(sceneColor: THREE.TextureNode, rooms?: FadeRooms): THREE.Node<"vec4">;
  /** The camera the frame was drawn with, and where the player stands. Call every frame */
  update(camera: THREE.Camera, at: null | { x: number; z: number }): void;
  /** Whether the horizon is drawn at all. A uniform, so it costs no rebuild to change */
  setFadeEnabled(next: boolean): void;
};

/**
 * What the post pass does to the finished frame — kept apart from `WorldView`, which owns the
 * pipeline and the `gl.render` it hangs off, so an effect can be rewritten without touching any
 * of that.
 *
 * The effect is a horizon, in alpha: the world fades out beyond a fixed distance of the PLAYER,
 * measured across the ground rather than from the camera. So it is a circle about them that the
 * view carries around, and it means the same thing whatever the camera does — which nothing
 * measured in screen space or along the view axis can manage.
 *
 * Every pixel is placed where its view ray meets the ground, which is the plane the horizon is
 * drawn on — and needs no depth buffer, which suits a floor that does not write one (it would
 * z-fight in the hull doorways). Sky, whose rays never meet the ground, ends up far away and faded.
 *
 * What it fades INTO is a striped backdrop — the page's own pattern, moved inside the canvas so
 * nothing shows through the doors that should not. That the pass decides is the point: a door at
 * 0.8 with nothing behind it reads as solid against the stripes, which its own material could
 * never arrange — it has no idea whether a room or the sky is behind it.
 */
export function createPostProcessing(): PostProcessing {
  // to turn a pixel back into a view ray
  const camProjectionMatrixInverse = uniform(new THREE.Matrix4());
  const camWorldMatrix = uniform(new THREE.Matrix4());
  /** Where the player stands, in world XZ — the centre of the horizon */
  const centre = uniform(new THREE.Vector2());
  /** `0` leaves the frame exactly as it arrived */
  const fade = uniform(0);
  /** What `setFadeEnabled` was told — `update` also needs a player to centre the horizon on */
  let fadeEnabled = true;

  return {
    uid: crypto.randomUUID(),

    setFadeEnabled(next) {
      fadeEnabled = next === true;
    },

    update(camera, at) {
      camera.updateMatrixWorld(); // so it is this frame's, not the last one's
      camProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      camWorldMatrix.value.copy(camera.matrixWorld);
      if (at !== null) centre.value.set(at.x, at.z);
      // without a player it would be a circle about the world origin, hiding most of the map
      fade.value = fadeEnabled === true && at !== null ? 1 : 0;
    },

    apply(sceneColor, rooms) {
      return Fn(() => {
        // The camera is the origin in view space, so a point on the ray IS its direction. Where it
        // meets the ground is where this pixel counts as standing — a wall is as near as the floor
        // behind it, which is what a horizon drawn on the floor should mean
        const onRay = getViewPosition(screenUV, float(1), camProjectionMatrixInverse);
        const rayDir = camWorldMatrix.mul(vec4(onRay, 0)).xyz;
        const camPos = camWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz;
        // the camera looks down, so `y` is negative; the cap keeps a ray along the horizon far away
        // rather than sending it up behind us
        const worldXZ = camPos.xz.add(rayDir.xz.mul(camPos.y.div(rayDir.y.min(-1e-4).negate())));

        const fromPlayer = worldXZ.sub(centre).length();

        // Two ramps rather than one: the first drops quickly to `horizonKneeAlpha` just past the
        // edge, the second takes the rest of the way out gently. One smoothstep either reaches
        // nothing at its start or takes too long to arrive, where this reads as an edge that
        // softens and then a long tail
        const near = smoothstep(float(horizonFrom), float(horizonKnee), fromPlayer);
        const far = smoothstep(float(horizonKnee), float(horizonTo), fromPlayer);
        const alpha = float(1)
          .sub(near.mul(1 - horizonKneeAlpha).mul(fade))
          .sub(far.mul(horizonKneeAlpha).mul(fade));

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
        // coverage beside it, which is what makes the composite below a plain sum
        const world = sceneColor.rgb.mul(drawn);
        const coverage = drawn;

        // `world` is premultiplied, so it goes in as it is rather than through the `mix`
        const composed = backdrop.mul(coverage.mul(alpha).oneMinus()).add(world.mul(alpha));

        // 🚧 debug: the outlines of the rooms in view, laid OVER the finished frame rather than
        // into the world, so they read wherever they fall
        if (rooms === undefined) return vec4(composed, 1);
        const onEdge = smoothstep(float(roomEdgeWidth), float(0), rooms.distanceAt(worldXZ));
        return vec4(mix(composed, roomEdgeColor, onEdge), 1);
      })();
    },
  };
}

/** The coverage a fragment must carry to count as fully drawn — see `drawn` */
const coverageFull = 0.85;

/**
 * The horizon, in metres from the player across the ground: full opacity to `from`, dropping
 * quickly to `kneeAlpha` by `knee`, then trailing away to nothing by `to`
 */
const horizonFrom = 6.5;
const horizonKnee = 7.25;
const horizonKneeAlpha = 0.5;
const horizonTo = 8.5;

/** 🚧 debug: the room outlines — how wide the line is, in metres, and its ink */
const roomEdgeWidth = 0.06;
const roomEdgeColor = /* @__PURE__ */ vec3(1, 0.1, 0.1);

/** What lies beyond the world: near-black, ruled with hairline diagonals */
const backdropColor = vec3(0.0, 0.0, 0.0);
const stripeColor = vec3(0.3, 0.22, 0.22);
const stripeAlpha = 0.05;
/** Both in device pixels, measured ALONG the diagonal — so the gap between stripes is `1 / √2` of it */
const stripePeriodPx = 16;
const stripeWidthPx = 1.5;
