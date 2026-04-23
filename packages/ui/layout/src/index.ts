import { BaseUiMetaSchema, defineUi } from "@npc-cli/ui-sdk/schema";
import { lazy } from "react";

export default defineUi({
  ui: lazy(() => import("./Layout")),
  bootstrap: null,
  schema: BaseUiMetaSchema,
});
