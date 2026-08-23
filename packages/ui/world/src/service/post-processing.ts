import {
  Fn,
  float,
  getViewPosition,
  logarithmicDepthToViewZ,
  screenUV,
  smoothstep,
  uniform,
  vec4,
  viewZToPerspectiveDepth,
} from "three/tsl";
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
   * @param sceneDepth the pass's `depth` — raw logarithmic, inverted here to a world position
   */
  apply(sceneColor: THREE.Node<"vec4">, sceneDepth: THREE.TextureNode): THREE.Node<"vec4">;
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
 * Every pixel's world position is recovered from the depth buffer, which is why the floor must
 * write depth. Anything that does not — the walls, and the sky — reads as the far plane and is
 * beyond the horizon by definition.
 */
export function createPostProcessing(): PostProcessing {
  // to invert the frame's depth back into a world position
  const camProjectionMatrixInverse = uniform(new THREE.Matrix4());
  const camWorldMatrix = uniform(new THREE.Matrix4());
  const camNear = uniform(0.1);
  const camFar = uniform(1000);
  /** Where the player stands, in world XZ — the centre of the horizon */
  const centre = uniform(new THREE.Vector2());
  /** `0` leaves the frame exactly as it arrived — see `setFadeEnabled` */
  const fade = uniform(1);

  return {
    uid: crypto.randomUUID(),

    setFadeEnabled(next) {
      fade.value = next === true ? 1 : 0;
    },

    update(camera, at) {
      camera.updateMatrixWorld(); // so it is this frame's, not the last one's
      camProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      camWorldMatrix.value.copy(camera.matrixWorld);
      const perspective = camera as THREE.PerspectiveCamera;
      camNear.value = perspective.near;
      camFar.value = perspective.far;
      if (at !== null) centre.value.set(at.x, at.z);
    },

    apply(sceneColor, sceneDepth) {
      return Fn(() => {
        // the buffer holds a LOGARITHMIC depth, which has to be linearised before it can be turned
        // back into a position
        const viewZ = logarithmicDepthToViewZ(sceneDepth.r, camNear, camFar);
        const ndcDepth = viewZToPerspectiveDepth(viewZ, camNear, camFar);
        const viewPos = getViewPosition(screenUV, ndcDepth, camProjectionMatrixInverse);
        const worldXZ = camWorldMatrix.mul(vec4(viewPos, 1)).xyz.xz;

        // across the GROUND, so a pixel high on a wall is as near as its feet are — the horizon
        // is a circle drawn on the floor, not a sphere about the player's head
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
