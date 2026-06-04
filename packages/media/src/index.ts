// import extraRootThinnerGltf from "./blockbench/with-extra-root/extra-root.thinner.gltf?url";
// import templateExtraRootGltf from "./blockbench/with-extra-root/template.extra-root.gltf?url";

import templateMoreAnimsGltf from "./blockbench/with-extra-root/thinner.more-anims.gltf?url";
import templateMoreAnimsWipGltf from "./blockbench/with-extra-root/thinner.more-anims.wip.gltf?url";

export const url = {
  /**
   * Extra root is same as 'template' but with extra root "skeleton-root",
   * > root -> skeleton-root -> ...
   *
   * This permits us to attach a shadow quad and label to "root",
   * without them being affected by the skeleton's animation.
   */
  templateMoreAnimsGltf,
  templateMoreAnimsWipGltf,
};
