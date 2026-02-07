import { defineUi } from "@npc-cli/ui-sdk";
import { lazy } from "react";
import { TabsUiMetaSchema } from "./schema";

export default defineUi({
  ui: lazy(() => import("./Tabs")),
  bootstrap: null,
  schema: TabsUiMetaSchema,
});
