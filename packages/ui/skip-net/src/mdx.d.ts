import type { articleComponents } from "./article/components";

declare global {
  /** What every article may use, read by the MDX extension to type its tags */
  type MDXProvidedComponents = typeof articleComponents;
}
