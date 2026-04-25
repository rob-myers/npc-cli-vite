import { defineUi } from "@npc-cli/ui-sdk/schema";
import { lazy } from "react";
import WorldBootstrap from "./bootstrap";
import { WorldUiSchema } from "./schema";

export default defineUi({
  ui: lazy(() => import("./components/World.tsx")),
  bootstrap: WorldBootstrap,
  schema: WorldUiSchema,
});

import "./geomorph.d.ts";
import "./world-worker.d.ts";
import "./world-graph.d.ts";

export type { State as WorldState } from "./components/World.tsx";
export type { ObjectPickKey } from "./service/pick";
