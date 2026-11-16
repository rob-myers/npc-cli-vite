import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import type { PaneNode } from "@npc-cli/util";
import z from "zod";

/** What a pane shows: nothing yet, the jobs library, the process leaders, an article, or an item jsh mounted on the World */
export type SkipNetLeaf = {
  kind: null | "library" | "jobs" | "article" | "item";
  /** The article's key, e.g. `npc-spawn` */
  articleKey?: string;
  /** The session its commands run in, else the first whose World is ours */
  sessionKey?: `tty-${number}`;
  /** The item's key, e.g. `sidestep` */
  itemKey?: string;
};

export type SkipNetPaneNode = PaneNode<SkipNetLeaf>;

export const SkipNetUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  uiKey: z.literal("SkipNet"),
  /** The World it is aligned with */
  worldKey: z.templateLiteral(["world-", z.number()]).default("world-0"),
  /** Its own layout of panes */
  panes: z
    .custom<SkipNetPaneNode>((x) => typeof x === "object" && x !== null && "type" in x && "id" in x)
    .default((): SkipNetPaneNode => ({ type: "leaf", id: 1, kind: null })),
});

export type SkipNetUiMeta = z.infer<typeof SkipNetUiMetaSchema>;
