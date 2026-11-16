import type { ArticleComponents } from "../articles";
import { Item } from "./Item";
import { ShellFence } from "./ShellFence";

/** In scope inside every `../articles/*.mdx`, via MDX's `components` prop */
export const articleComponents: ArticleComponents = {
  Item,
  pre: ShellFence,
};
