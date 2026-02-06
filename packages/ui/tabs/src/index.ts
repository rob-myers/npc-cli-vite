import { defineUi } from "@npc-cli/ui-sdk";
import { TabsUiMetaSchema } from "./schema";
import Tabs from "./Tabs";

export default defineUi({
  ui: Tabs,
  bootstrap: null,
  schema: TabsUiMetaSchema,
});
