import templateGltf from "./blockbench/template/template.gltf?url";
import templateExtraRootGltf from "./blockbench/with-extra-root/template.extra-root.gltf?url";
import extraRootThinnerGltf from "./blockbench/with-extra-root/thinner/extra-root.thinner.gltf?url";

export const url = {
  templateGltf,
  /**
   * Same as 'template' but with extra root "skeleton-root",
   * > root -> skeleton-root -> ...
   *
   * This permits us to attach a shadow quad and label to "root",
   * without them being affected by the skeleton's animation.
   */
  templateExtraRootGltf,
  extraRootThinnerGltf,
};
