import { defineUi } from "@npc-cli/ui-sdk/schema";
import { lazy } from "react";
import { SkipNetUiMetaSchema } from "./schema";

// `moduleDetection: force` means ambient declarations need importing
import "./virtual.d";

export default defineUi({
  ui: lazy(() => import("./SkipNet")),
  bootstrap: null,
  schema: SkipNetUiMetaSchema,
});
