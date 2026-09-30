import { defineUi } from "@npc-cli/ui-sdk/schema";
import { lazy } from "react";
import { TermGraphUiMetaSchema } from "./schema";

export default defineUi({
  ui: lazy(() => import("./TermGraph")),
  bootstrap: null,
  schema: TermGraphUiMetaSchema,
});
