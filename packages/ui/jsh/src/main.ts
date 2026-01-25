import { defineUi } from "@npc-cli/ui-sdk";
import { lazy } from "react";

import JshBootstrap from "./bootstrap";

export default defineUi({
  ui: lazy(() => import("./index")),
  bootstrap: JshBootstrap,
});
