import { pause } from "@npc-cli/util/legacy/generic";
import { type ComponentType, createElement, Fragment, type LazyExoticComponent, lazy } from "react";

export type ArticleComponents = Record<string, ComponentType<any>>;
type ArticleContent = ComponentType<{ components?: ArticleComponents }>;

/** An article's own `{folder}/{key}.mdx`, and its sections `{folder}/{key}/*.mdx`. Each is a chunk, fetched when first shown */
const loaders = import.meta.glob<{ default: ArticleContent }>(["./articles/*/*.mdx", "./articles/*/*/*.mdx"]);
type Loader = (typeof loaders)[string];
/** Each key's files: its own first, then its sections by name. Without `.mdx`, `{key}` sorts before `{key}/…` */
const keyToLoaders = new Map<string, Loader[]>();
for (const path of Object.keys(loaders).sort((a, b) => (a.slice(0, -4) < b.slice(0, -4) ? -1 : 1))) {
  keyToLoaders.set(toKey(path), [...(keyToLoaders.get(toKey(path)) ?? []), loaders[path]]);
}
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

if (import.meta.env.DEV && Object.keys(loaders).some((path) => keyToFolder.get(toKey(path)) !== toFolder(path))) {
  console.warn("SkipNet: two folders hold an article of one name, so one is hidden", Object.keys(loaders));
}

/** The folder holding the article, e.g. `npc` or `video` */
export function articleFolderOf(key: string): undefined | string {
  return keyToFolder.get(key);
}

/** `key` if it is an article's, else the first. A stale key falls back */
export function articleKeyOf(key: undefined | string): undefined | string {
  return articleKeys.find((x) => x === key) ?? articleKeys[0];
}

const lazyByKey = new Map<string, LazyExoticComponent<ArticleContent>>();

/**
 * The article's files one after another, loaded on first render, at least `firstShowMs` in.
 * A Suspense must be above it.
 */
export function getArticle(key: string): undefined | LazyExoticComponent<ArticleContent> {
  const loads = keyToLoaders.get(key);
  if (loads === undefined) return undefined;
  let Content = lazyByKey.get(key);
  if (Content === undefined) {
    lazyByKey.set(
      key,
      (Content = lazy(() =>
        Promise.all([Promise.all(loads.map((load) => load())), pause(firstShowMs)]).then(([ms]) => ({
          default: (props: { components?: ArticleComponents }) => Sections(ms, props),
        })),
      )),
    );
  }
  return Content;
}

/** Each file in a `section` of its own, which `ArticlePane` frames */
function Sections(ms: { default: ArticleContent }[], props: { components?: ArticleComponents }) {
  return createElement(
    Fragment,
    null,
    ...ms.map((m, i) => createElement("section", { key: i }, createElement(m.default, props))),
  );
}

/** Its spinner shows at least this long, so it never just flickers */
const firstShowMs = 500;

function rank(order: string[], key: string) {
  return order.indexOf(key) + 1 || Number.POSITIVE_INFINITY;
}

/** `./articles/npc/npc-spawn.mdx` or `./articles/npc/npc-spawn/001-foo.mdx` -> `npc-spawn` */
function toKey(path: string) {
  return path.replace(/^\.\/articles\/[^/]+\/([^/]+?)(\.mdx|\/[^/]+\.mdx)$/, "$1");
}

/** `./articles/npc/npc-spawn.mdx` -> `npc` */
function toFolder(path: string) {
  return path.replace(/^\.\/articles\/([^/]+)\/.*$/, "$1");
}
