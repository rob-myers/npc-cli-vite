import { defineUi } from "@npc-cli/ui-sdk/schema";
import { lazy } from "react";
import { JshPreludeUiMetaSchema } from "./schema";

export default defineUi({
  ui: lazy(() => import("./JshPrelude")),
  bootstrap: null,
  schema: JshPreludeUiMetaSchema,
});
