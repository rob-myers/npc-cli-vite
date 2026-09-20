import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { uiStoreApi } from "@npc-cli/ui-sdk/ui.store";
import { cn } from "@npc-cli/util";
import { useContext, useEffect, useRef } from "react";
import BlogComments from "./BlogComments";
import BlogNav from "./BlogNav";
import { mdxComponents } from "./mdx-components";
import { getBlogPage } from "./pages";
import type { BlogUiMeta } from "./schema";
import { useNearViewport } from "./use-near-viewport";

import "./blog.css";

export default function Blog({ meta }: { meta: BlogUiMeta }) {
  const { theme } = useContext(UiContext);
  const page = getBlogPage(meta.pageKey);
  const bodyRef = useRef<HTMLDivElement>(null);
  const seen = useNearViewport();

  useEffect(() => void bodyRef.current?.scrollTo({ top: 0 }), [page?.key]);

  if (page === undefined) {
    return <div className="p-4 text-sm text-term-muted">No pages in packages/ui/blog/src/pages</div>;
  }

  return (
    // `overflow-hidden` else a long article pushes the nav out of a short pane
    <div ref={seen.ref} className="size-full flex flex-col overflow-hidden bg-background text-on-background">
      <BlogNav
        pageKey={page.key}
        onSelect={(pageKey) => uiStoreApi.setUiMeta(meta.id, (draft) => void ((draft as BlogUiMeta).pageKey = pageKey))}
      />

      <div ref={bodyRef} className="flex-1 min-h-0 overflow-auto scrollbar-thin p-4">
        <article key={page.key} className={cn("prose max-w-[unset] leading-[1.4]", theme === "dark" && "prose-invert")}>
          <page.Content components={mdxComponents} />
        </article>

        <hr className="my-8 border-on-background/20" />

        {/* gated on the pane, not on scroll: loads whilst the article is read, idle in a hidden tab */}
        <div className="min-h-24">
          {/* no `key`: giscus swaps the thread in its live iframe, so the box stays up */}
          {seen.near && <BlogComments pageKey={page.key} />}
        </div>
      </div>
    </div>
  );
}
