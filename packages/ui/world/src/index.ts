import { defineUi } from "@npc-cli/ui-sdk";
import WorldBootstrap from "./bootstrap";
import { WorldUiSchema } from "./schema";
import World from "./World";

export default defineUi({
  ui: World,
  bootstrap: WorldBootstrap,
  schema: WorldUiSchema,
});
