export type MdxComponents = Record<string, React.ComponentType<any>>;
export type MdxContent = (props: { components?: MdxComponents }) => React.ReactNode;
export type MdxModule = { default: MdxContent; title?: string; order?: number };

export type BlogPage = { key: string; title: string; order: number; Content: MdxContent };

// adding or renaming a page forces a full reload, unlike `jobsExamplesPlugin`
const modules = import.meta.glob<MdxModule>("./pages/*.mdx", { eager: true });

export const blogPages: BlogPage[] = Object.entries(modules)
  .map(([filePath, mod]) => {
    const key = filePath.replace(/^.*\/(.+)\.mdx$/, "$1");
    return { key, title: mod.title ?? toTitle(key), order: mod.order ?? 1e3, Content: mod.default };
  })
  .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

/** Falls back to the first page, e.g. when a persisted `pageKey` was renamed away */
export function getBlogPage(pageKey: string | undefined): BlogPage | undefined {
  return blogPages.find((page) => page.key === pageKey) ?? blogPages[0];
}

/** `my-first-post` -> `My First Post` */
function toTitle(key: string): string {
  return key.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
