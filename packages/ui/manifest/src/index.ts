import { defineUi } from "@npc-cli/ui-sdk/schema";
import { lazy } from "react";
import { ManifestUiMetaSchema } from "./schema";

export default defineUi({
  ui: lazy(() => import("./Manifest")),
  bootstrap: null,
  schema: ManifestUiMetaSchema,
});
