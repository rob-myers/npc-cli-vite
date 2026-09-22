import { defineUi } from "@npc-cli/ui-sdk/schema";
import { lazy } from "react";
import { DecoratorUiMetaSchema } from "./schema";

export default defineUi({
  ui: lazy(() => import("./Decorator")),
  bootstrap: null,
  schema: DecoratorUiMetaSchema,
});
