import { defineUi } from "@npc-cli/ui-sdk/schema";
import { lazy } from "react";
import { JshBootstrap } from "./bootstrap";
import { JshUiSchema } from "./schema";

export default defineUi({
  ui: lazy(() => import("./Jsh")),
  bootstrap: JshBootstrap,
  schema: JshUiSchema,
});
