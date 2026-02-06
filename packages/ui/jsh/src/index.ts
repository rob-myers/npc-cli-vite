import { defineUi } from "@npc-cli/ui-sdk";
import { JshBootstrap } from "./bootstrap";
import Jsh from "./Jsh";
import { JshUiSchema } from "./schema";

export default defineUi({
  ui: Jsh,
  bootstrap: JshBootstrap,
  schema: JshUiSchema,
});
