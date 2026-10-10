import { defineUi } from "@npc-cli/ui-sdk/schema";
import { lazy } from "react";
import { AudioUiMetaSchema } from "./schema";

export default defineUi({
  ui: lazy(() => import("./Audio")),
  bootstrap: null,
  schema: AudioUiMetaSchema,
});
