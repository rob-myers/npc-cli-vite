import { type ComponentType, type LazyExoticComponent, lazy } from "react";

export type ArticleComponents = Record<string, ComponentType<any>>;
type ArticleContent = ComponentType<{ components?: ArticleComponents }>;

/** Not eager, so each article is a chunk of its own, fetched when first shown */
const loaders = import.meta.glob<{ default: ArticleContent }>("./articles/*.mdx");
const keyToLoader = new Map(Object.entries(loaders).map(([path, load]) => [toKey(path), load]));

// biome-ignore format: emphasis
/** Picker order. Unlisted articles follow, alphabetically */
const articleOrder = [
  "npc-controls",
  "npc-object-pick",
  "npc-spawn",
  "npc-move",
  "npc-doors",
  "npc-world-events",
  "npc-world-api",
  "npc-decor",
  "npc-navmesh",
  "npc-sidestep",
  "npc-shell-code",
  "npc-unsorted",
];

export const articleKeys = [...keyToLoader.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

/** `key` if it is an article's, else the first. A stale key falls back */
export function articleKeyOf(key: undefined | string): undefined | string {
  return articleKeys.find((x) => x === key) ?? articleKeys[0];
}

const lazyByKey = new Map<string, LazyExoticComponent<ArticleContent>>();

/** The article's content, loaded on first render. A Suspense must be above it */
export function getArticle(key: string): undefined | LazyExoticComponent<ArticleContent> {
  const load = keyToLoader.get(key);
  if (load === undefined) return undefined;
  let Content = lazyByKey.get(key);
  if (Content === undefined) lazyByKey.set(key, (Content = lazy(load)));
  return Content;
}

function rank(key: string) {
  return articleOrder.indexOf(key) + 1 || Number.POSITIVE_INFINITY;
}

/** `./articles/npc-spawn.mdx` -> `npc-spawn` */
function toKey(path: string) {
  return path.replace(/^.*\/(.+)\.mdx$/, "$1");
}
