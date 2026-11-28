import { lazy } from "react";
import type { ArticleComponents } from "../articles";
import { ActivationProcedures, ContainmentProcedures, Description, FileSection, TapeTitle } from "./FileSection";
import { Item } from "./Item";
import { BoltIcon, CopyIcon, EditIcon, PlayIcon } from "./icons";
import { Link } from "./Link";
import { ShellFence } from "./ShellFence";
import { SideNote } from "./SideNote";

/** In scope inside every article, via MDX's `components` prop */
export const articleComponents = {
  a: Link,
  ActivationProcedures,
  BoltIcon,
  ContainmentProcedures,
  CopyIcon,
  Description,
  EditIcon,
  FileSection,
  Item,
  PlayIcon,
  pre: ShellFence,
  SideNote,
  TapeTitle,
  /** Lazy, so the YouTube embed loads only with an article showing one */
  Video: lazy(() => import("./Video")),
} satisfies ArticleComponents;
