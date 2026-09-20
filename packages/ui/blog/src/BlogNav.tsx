import { cn } from "@npc-cli/util";
import { blogPages } from "./pages";

/** Horizontal page strip, styled like the `JobsLibrary` nav */
export default function BlogNav({ pageKey, onSelect }: { pageKey: string; onSelect(key: string): void }) {
  return (
    <nav
      className={cn(
        "shrink-0 flex items-end min-w-0 px-2 py-1 overflow-x-auto scrollbar-thin touch-pan-x",
        "border-b border-term-border-subtle",
      )}
    >
      {blogPages.map((page) => (
        <button
          key={page.key}
          type="button"
          onClick={() => onSelect(page.key)}
          className={cn(
            "px-2 py-1 cursor-pointer border-b transition-colors text-nowrap",
            page.key === pageKey
              ? "text-term-accent border-term-accent"
              : "text-term-muted border-transparent hover:text-term-foreground",
          )}
        >
          {page.title}
        </button>
      ))}
    </nav>
  );
}
