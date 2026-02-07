import { defineUi } from "@npc-cli/ui-sdk";
import { lazy } from "react";
import WorldBootstrap from "./bootstrap";
import { WorldUiSchema } from "./schema";

export default defineUi({
  ui: lazy(() => import("./World")),
  bootstrap: WorldBootstrap,
  schema: WorldUiSchema,
});
