import { lazy } from "react";
import type { ArticleComponents } from "../articles";
import { ActivationProcedures, Description, FileSection, TapeTitle } from "./FileSection";
import { Item } from "./Item";
import { ShellFence } from "./ShellFence";
import { SideNote } from "./SideNote";

/** In scope inside every article, via MDX's `components` prop */
export const articleComponents = {
  ActivationProcedures,
  Description,
  FileSection,
  Item,
  pre: ShellFence,
  SideNote,
  TapeTitle,
  /** Lazy, so the YouTube embed loads only with an article showing one */
  Video: lazy(() => import("./Video")),
} satisfies ArticleComponents;
