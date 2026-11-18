import { lazy } from "react";
import type { ArticleComponents } from "../articles";
import { Item } from "./Item";
import { ShellFence } from "./ShellFence";

/** In scope inside every article, via MDX's `components` prop */
export const articleComponents: ArticleComponents = {
  Item,
  pre: ShellFence,
  /** Lazy, so the YouTube embed loads only with an article showing one */
  Video: lazy(() => import("./Video")),
};
