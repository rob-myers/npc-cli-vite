import { defineUi } from "@npc-cli/ui-sdk";
import { TemplateUiMetaSchema } from "./schema";
import Template from "./Template";

export default defineUi({
  ui: Template,
  bootstrap: null,
  schema: TemplateUiMetaSchema,
});
