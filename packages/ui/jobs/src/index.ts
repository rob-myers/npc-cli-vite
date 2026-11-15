import { defineUi } from "@npc-cli/ui-sdk/schema";
import { lazy } from "react";
import { JobsUiMetaSchema } from "./schema";

export default defineUi({
  ui: lazy(() => import("./Jobs")),
  bootstrap: null,
  schema: JobsUiMetaSchema,
});
