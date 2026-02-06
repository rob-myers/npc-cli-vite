import { BaseUiMetaSchema, defineUi } from "@npc-cli/ui-sdk";
import Global from "./Global";

export default defineUi({
  ui: Global,
  bootstrap: null,
  schema: BaseUiMetaSchema,
});
