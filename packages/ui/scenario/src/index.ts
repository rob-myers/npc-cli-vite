import { defineUi } from "@npc-cli/ui-sdk/schema";
import { lazy } from "react";
import { ScenarioUiMetaSchema } from "./schema";

export default defineUi({
  ui: lazy(() => import("./Scenario")),
  bootstrap: null,
  schema: ScenarioUiMetaSchema,
});
