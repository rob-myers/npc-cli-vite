import { defineUi } from "@npc-cli/ui-sdk/schema";
import { lazy } from "react";
import { NavRoutesUiMetaSchema } from "./schema";

export default defineUi({
  ui: lazy(() => import("./NavRoutes")),
  bootstrap: null,
  schema: NavRoutesUiMetaSchema,
});
