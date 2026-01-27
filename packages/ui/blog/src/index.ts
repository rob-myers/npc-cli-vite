import { defineUi } from "@npc-cli/ui-sdk";
import { lazy } from "react";

import "./mdx.d";

export default defineUi({
  ui: lazy(() => import("./Blog")),
});
