import { defineUi } from "@npc-cli/ui-sdk/schema";
import { lazy } from "react";
import { TemplateUiMetaSchema } from "./schema";

export default defineUi({
  ui: lazy(() => import("./Demo")),
  bootstrap: null,
  schema: TemplateUiMetaSchema,
});
