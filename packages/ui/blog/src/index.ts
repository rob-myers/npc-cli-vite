import { defineUi } from "@npc-cli/ui-sdk/schema";
import { lazy } from "react";
import { BlogUiMetaSchema } from "./schema";

// `moduleDetection: force` means ambient declarations need importing
import "./mdx.d";

export default defineUi({
  ui: lazy(() => import("./Blog")),
  bootstrap: null,
  schema: BlogUiMetaSchema,
});
