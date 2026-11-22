import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

/** What a window shows: the files folder, an article, an item jsh mounted on the World, or the chat */
export type SkipNetKind = "folder" | "article" | "item" | "chat";

/** A window's kind, and what it shows */
export type SkipNetContent = {
  kind: SkipNetKind;
  /** The session its commands run in, else the first whose World is ours */
  sessionKey?: `tty-${number}`;
  /** The article's key, e.g. `npc-spawn` */
  articleKey?: string;
  /** The item's key, e.g. `sidestep` */
  itemKey?: string;
  /** The chat's thread, `general` or an article's key. Unset, `general` */
  threadKey?: string;
};

/** A window on the desktop, placed in grid cells. A higher `z` stacks it over others */
export type SkipNetWindow = SkipNetContent & {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  /** Its height to restore, whilst windowshaded to its title bar */
  shadedH?: number;
  /** Its share of a stack's height, once a bar was dragged there. Else its `h` */
  stackFlex?: number;
  /** Its place in a stack, once moved there. Else after those placed, in the desktop's reading order */
  stackOrder?: number;
  /** Its height is fitted to its article once shown, then this is cleared */
  fit?: boolean;
  /** The files window's open folders. Unset, every folder is open */
  openFolders?: string[];
};

export const SkipNetUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  uiKey: z.literal("SkipNet"),
  /** The World it is aligned with */
  worldKey: z.templateLiteral(["world-", z.number()]).default("world-0"),
  windows: z
    .custom<SkipNetWindow[]>((x) => Array.isArray(x))
    /** Saved jobs and library windows are dropped: those kinds are gone */
    .transform((windows) => windows.filter((x) => (x.kind as string) !== "jobs" && (x.kind as string) !== "library"))
    /** The files folder, and its first npc article beside it, or below it when stacked */
    .default((): SkipNetWindow[] => [
      { id: "w1", kind: "folder", x: 0, y: 0, w: 20, h: 12, z: 1 },
      { id: "w2", kind: "article", articleKey: "npc-controls", x: 21, y: 0, w: 30, h: 24, z: 2 },
    ]),
  /** A window to open once shown, asked for from outside e.g. by the app's intro toast */
  opening: z.custom<SkipNetContent>((x) => typeof x === "object" && x !== null).optional(),
  /** Each code fence's height by its id, once resized by its corner */
  fenceHeights: z.record(z.string(), z.number()).optional(),
});

export type SkipNetUiMeta = z.infer<typeof SkipNetUiMetaSchema>;
