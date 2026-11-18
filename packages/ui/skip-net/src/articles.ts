import { type ComponentType, type LazyExoticComponent, lazy } from "react";

export type ArticleComponents = Record<string, ComponentType<any>>;
type ArticleContent = ComponentType<{ components?: ArticleComponents }>;

/** Not eager, so each article is a chunk of its own, fetched when first shown */
const loaders = import.meta.glob<{ default: ArticleContent }>("./articles/*/*.mdx");
const keyToLoader = new Map(Object.entries(loaders).map(([path, load]) => [toKey(path), load]));
const keyToFolder = new Map(Object.keys(loaders).map((path) => [toKey(path), toFolder(path)]));

/** Folder order. Unlisted folders follow, alphabetically */
const folderOrder = ["video", "npc"];

// biome-ignore format: emphasis
/** Article order within a folder. Unlisted articles follow, alphabetically */
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

/** Each folder, its articles in order. A folder is a directory of `./articles` */
export const articleFolders = [...new Set(keyToFolder.values())]
  .sort((a, b) => rank(folderOrder, a) - rank(folderOrder, b) || a.localeCompare(b))
  .map((key) => ({
    key,
    articleKeys: [...keyToFolder.keys()]
      .filter((x) => keyToFolder.get(x) === key)
      .sort((a, b) => rank(articleOrder, a) - rank(articleOrder, b) || a.localeCompare(b)),
  }));

/** Every article, folder by folder */
export const articleKeys = articleFolders.flatMap((x) => x.articleKeys);

if (import.meta.env.DEV && keyToLoader.size < Object.keys(loaders).length) {
  console.warn("SkipNet: two articles share a name, so one is hidden", Object.keys(loaders));
}

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

function rank(order: string[], key: string) {
  return order.indexOf(key) + 1 || Number.POSITIVE_INFINITY;
}

/** `./articles/npc/npc-spawn.mdx` -> `npc-spawn` */
function toKey(path: string) {
  return path.replace(/^.*\/(.+)\.mdx$/, "$1");
}

/** `./articles/npc/npc-spawn.mdx` -> `npc` */
function toFolder(path: string) {
  return path.replace(/^.*\/(.+)\/[^/]+\.mdx$/, "$1");
}
