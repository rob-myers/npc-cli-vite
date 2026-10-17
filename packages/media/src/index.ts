import currentGlb from "./blockbench/current/current.glb?url";
import currentGltf from "./blockbench/current/current.gltf?url";

export const url = {
  /** Production's model, written from `currentGltf` by `gen-current-glb` */
  currentGlb,
  /**
   * Has extra root which template model does not:
   * > root -> skeleton-root -> ...
   *
   * This permits us to attach a shadow quad and label to "root",
   * without them being affected by the skeleton's animation.
   */
  currentGltf,
};
