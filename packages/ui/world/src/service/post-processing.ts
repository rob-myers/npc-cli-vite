import { Fn, float, getViewPosition, screenUV, smoothstep, uniform, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";

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
  apply(sceneColor: THREE.Node<"vec4">): THREE.Node<"vec4">;
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

    apply(sceneColor) {
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

        // The canvas composites PREMULTIPLIED (`alpha: true` gives three `alphaMode:
        // "premultiplied"`), so the colour must be scaled by the same alpha. Reducing alpha alone
        // leaves the colour at full strength and merely adds the page beneath it, which reads as
        // the world brightening rather than fading
        return vec4(sceneColor.rgb.mul(alpha), sceneColor.a.mul(alpha));
      })();
    },
  };
}

/**
 * The horizon, in metres from the player across the ground: full opacity to `from`, dropping
 * quickly to `kneeAlpha` by `knee`, then trailing away to nothing by `to`
 */
const horizonFrom = 6;
const horizonKnee = 6.75;
const horizonKneeAlpha = 0.5;
const horizonTo = 8;
