import { defineUi } from "@npc-cli/ui-sdk";
import { lazy } from "react";
import { TemplateUiMetaSchema } from "./schema";

export default defineUi({
  ui: lazy(() => import("./Template")),
  bootstrap: null,
  schema: TemplateUiMetaSchema,
});
