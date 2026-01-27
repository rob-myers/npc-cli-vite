import { defineUi } from "@npc-cli/ui-sdk";
import { lazy } from "react";

export default defineUi({
  ui: lazy(() => import("./World")),
  bootstrap: null,
});
