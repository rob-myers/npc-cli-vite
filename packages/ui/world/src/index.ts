import { defineUi } from "@npc-cli/ui-sdk";
import { lazy } from "react";
import { WorldUiSchema } from "./schema";

export default defineUi({
  ui: lazy(() => import("./World")),
  bootstrap: null,
  schema: WorldUiSchema,
});
