import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

/** What a window shows: the npc folder, an article, the jobs library, or an item jsh mounted on the World */
export type SkipNetKind = "folder" | "article" | "library" | "item";

/** A window's kind, and what it shows */
export type SkipNetContent = {
  kind: SkipNetKind;
  /** The session its commands run in, else the first whose World is ours */
  sessionKey?: `tty-${number}`;
  /** The article's key, e.g. `npc-spawn` */
  articleKey?: string;
  /** The item's key, e.g. `sidestep` */
  itemKey?: string;
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
};

export const SkipNetUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  uiKey: z.literal("SkipNet"),
  /** The World it is aligned with */
  worldKey: z.templateLiteral(["world-", z.number()]).default("world-0"),
  /** Windows overlap freely, else stay compacted upwards */
  arrange: z.enum(["free", "tidy"]).default("free"),
  windows: z
    .custom<SkipNetWindow[]>((x) => Array.isArray(x))
    /** Jobs windows were dropped: jobs are now shown in their tty */
    .transform((windows) => windows.filter((x) => (x.kind as string) !== "jobs"))
    .default((): SkipNetWindow[] => [
      { id: "w1", kind: "folder", x: 0, y: 0, w: 20, h: 12, z: 1 },
      { id: "w2", kind: "library", x: 21, y: 1, w: 30, h: 24, z: 2 },
    ]),
});

export type SkipNetUiMeta = z.infer<typeof SkipNetUiMetaSchema>;
