import { BaseUiMetaSchema, defineUi } from "@npc-cli/ui-sdk";
import Blog from "./Blog";

import "./mdx.d";

export default defineUi({
  ui: Blog,
  bootstrap: null,
  schema: BaseUiMetaSchema,
});
