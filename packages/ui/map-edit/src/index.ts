import { defineUi } from "@npc-cli/ui-sdk/schema";
import { lazy } from "react";
import { MapEditUiMetaSchema } from "./schema";

import "./@dragdroptouch__drag-drop-touch.d";

export default defineUi({
  ui: lazy(() => import("./MapEdit")),
  bootstrap: null,
  schema: MapEditUiMetaSchema,
});

export * from "./map-node-api";
