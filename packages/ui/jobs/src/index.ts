import { defineUi } from "@npc-cli/ui-sdk/schema";
import { lazy } from "react";
import { TemplateUiMetaSchema } from "./schema";

// `moduleDetection: force` means ambient declarations need importing
import "./virtual.d";

export default defineUi({
  // ui: lazy(() => import("./Template")),
  ui: lazy(() => import("./Jobs")),
  bootstrap: null,
  schema: TemplateUiMetaSchema,
});
