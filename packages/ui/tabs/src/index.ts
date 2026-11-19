import { defineUi } from "@npc-cli/ui-sdk/schema";
import { TabsUiMetaSchema } from "./schema";
import Tabs from "./Tabs";

export default defineUi({
  ui: Tabs, // not lazy: every pane's header is on screen from the first render
  bootstrap: null,
  schema: TabsUiMetaSchema,
});
