import { cn } from "@npc-cli/util";
import TestMdx from "./pages/test-mdx.mdx";

// 🚧 get theme from ui context
const theme = "dark";

export function Blog() {
  return (
    <div
      className={cn(
        theme === "dark" && "prose-invert",
        "prose h-full max-w-[unset] border border-on-background/60 leading-[1.4]",
      )}
    >
      <div className="overflow-auto p-4 size-full">
        <TestMdx />
      </div>
    </div>
  );
}
