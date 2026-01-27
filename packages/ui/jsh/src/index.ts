import { BaseUiMetaSchema, defineUi } from "@npc-cli/ui-sdk";
import { lazy } from "react";
import z from "zod";
import JshBootstrap from "./bootstrap";

const schema = z.object({
  ...BaseUiMetaSchema.shape,
  sessionKey: z.templateLiteral(["tty-", z.number()]),
});

export default defineUi({
  ui: lazy(() => import("./Jsh")),
  bootstrap: JshBootstrap,
  schema,
});

export type JshUiMeta = z.infer<typeof schema>;
