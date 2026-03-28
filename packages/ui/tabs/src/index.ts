import { defineUi } from "@npc-cli/ui-sdk/schema";
import { lazy } from "react";
import { TabsUiMetaSchema } from "./schema";

export default defineUi({
  ui: lazy(() => import("./Tabs")),
  bootstrap: null,
  schema: TabsUiMetaSchema,
});
