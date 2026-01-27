import { BaseUiMetaSchema, defineUi } from "@npc-cli/ui-sdk";
import { lazy } from "react";

export default defineUi({
  ui: lazy(() => import("./Global")),
  bootstrap: null,
  schema: BaseUiMetaSchema,
});
