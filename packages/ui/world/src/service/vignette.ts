import {
  Fn,
  float,
  getViewPosition,
  If,
  length,
  logarithmicDepthToViewZ,
  mix,
  screenUV,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec4,
  viewZToPerspectiveDepth,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { wallHeight } from "../const";

/**
 * Darkens `color` towards the corners of the frame.
 *
 * @param amount `0` is exactly identity, `1` fully applies it — see `w.view.fx`
 * @param lit How lit this pixel is — see `createVignetteFocus`, which holds the darkening off
 * around the player
 */
export function applyVignette(
  color: THREE.Node<"vec3">,
  amount: THREE.Node<"float">,
  lit: THREE.Node<"float">,
): THREE.Node<"vec3"> {
  // bright within `inner`, dark beyond `outer`
  const corners = smoothstep(vignetteInner, vignetteOuter, length(uv().sub(0.5))).oneMinus();
  // light wins: a lit pixel is darkened at most down to its own brightness, so a lamp
  // near the edge of frame still reads rather than being crushed
  const factor = corners.max(lit);
  return color.mul(mix(1, factor, amount));
}

/** Radius (in uv, so the corner is ~0.707) within which nothing is darkened */
const vignetteInner = 0.1;
/** Radius beyond which it is fully dark */
const vignetteOuter = 0.5;

export type VignetteFocus = {
  /** The reconstruction depends on the camera alone, so this need only run when it moves */
  update(camera: THREE.Camera): void;
  /** Where the focus stands, in world XZ. `null` whilst there is no player to stand anywhere */
  setCentre(centre: null | { x: number; z: number }): void;
  /**
   * `1` for a fragment within `focusRadius` of that centre, easing to `0` over `focusFeather`.
   * Feed it to `applyVignette` as `lit`.
   */
  amount(sceneDepth: THREE.Node<"float">): THREE.Node<"float">;
};

/**
 * A cylinder of world standing on the player, which the vignette leaves alone — so they read
 * even when the frame's edges are crushed, as the tracked light used to ensure.
 *
 * A CYLINDER, not a sphere: the fragment's world XZ decides how near the player it is, and its
 * world Y only whether it falls under the cylinder's lid — so the exemption holds all the way up
 * a wall beside them rather than fading out, but stops at `focusHeight` and spares no ceiling.
 */
export function createVignetteFocus(): VignetteFocus {
  const camProjectionMatrixInverse = uniform(new THREE.Matrix4());
  const camWorldMatrix = uniform(new THREE.Matrix4());
  const camPosition = uniform(new THREE.Vector3());
  const camNear = uniform(0.1);
  const camFar = uniform(1000);
  /** `xy` the centre in world XZ, `z` whether there is one at all */
  const centre = uniform(new THREE.Vector3());

  return {
    update(camera) {
      camera.updateMatrixWorld();
      camProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      camWorldMatrix.value.copy(camera.matrixWorld);
      camPosition.value.copy(camera.position);
      const perspectiveCam = camera as THREE.PerspectiveCamera;
      camNear.value = perspectiveCam.near;
      camFar.value = perspectiveCam.far;
    },
    setCentre(next) {
      if (next === null) {
        centre.value.z = 0;
      } else {
        centre.value.set(next.x, next.z, 1);
      }
    },
    amount(sceneDepth) {
      return Fn(() => {
        const viewZ = logarithmicDepthToViewZ(sceneDepth, camNear, camFar);
        // depthWrite:false surfaces (e.g. the floor) read back as far-plane
        const isBackground = viewZ.negate().greaterThan(camFar.mul(0.99));

        const worldXZ = vec2(0, 0).toVar();
        const worldY = float(0).toVar();

        If(isBackground, () => {
          // nothing was drawn here, so take where this pixel's ray meets the ground instead
          const viewDirPoint = getViewPosition(screenUV, float(0.5), camProjectionMatrixInverse);
          const worldDir = camWorldMatrix.mul(vec4(viewDirPoint, 0.0)).xyz.normalize();
          const t = float(0).sub(camPosition.y).div(worldDir.y);
          worldXZ.assign(camPosition.add(worldDir.mul(t)).xz);
        }).Else(() => {
          const ndcDepth = viewZToPerspectiveDepth(viewZ, camNear, camFar);
          const viewPos = getViewPosition(screenUV, ndcDepth, camProjectionMatrixInverse);
          const worldPos = camWorldMatrix.mul(vec4(viewPos, 1.0)).xyz;
          worldXZ.assign(worldPos.xz);
          worldY.assign(worldPos.y);
        });

        const dist = worldXZ.sub(centre.xy).length();
        const withinRadius = smoothstep(focusRadius, focusRadius - focusFeather, dist);
        // eased over the last few centimetres, else the lid is a hard line across a wall
        const underLid = smoothstep(focusHeight, focusHeight - focusLidFeather, worldY);
        return withinRadius.mul(underLid).mul(centre.z);
      })();
    },
  };
}

/** Radius (metres) of the cylinder the vignette leaves alone, and how far its edge eases over */
const focusRadius = 3;
const focusFeather = 1.5;
/** Its lid: just under the walls, so what stands beside the player is spared but no ceiling is */
const focusHeight = wallHeight + 0.5;
const focusLidFeather = 0.0001;
