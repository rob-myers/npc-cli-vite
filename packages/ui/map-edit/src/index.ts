import { defineUi } from "@npc-cli/ui-sdk";
import { lazy } from "react";
import { MapEditUiMetaSchema } from "./schema";

import "./@dragdroptouch__drag-drop-touch.d";

export default defineUi({
  ui: lazy(() => import("./MapEdit")),
  bootstrap: null,
  schema: MapEditUiMetaSchema,
});

export { RenderMapNodes } from "./MapEditSvg";
export * from "./map-node-api";
