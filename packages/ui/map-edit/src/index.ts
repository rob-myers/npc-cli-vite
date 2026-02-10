import { defineUi } from "@npc-cli/ui-sdk";
import { lazy } from "react";
import { MapEditUiMetaSchema } from "./schema";

export default defineUi({
  ui: lazy(() => import("./MapEdit")),
  bootstrap: null,
  schema: MapEditUiMetaSchema,
});
