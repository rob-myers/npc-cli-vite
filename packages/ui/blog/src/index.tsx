import { UiContext } from "@npc-cli/ui-sdk";
import { cn } from "@npc-cli/util";
import { useContext } from "react";
import TestMdx from "./pages/test-mdx.mdx";

export function Blog() {
  const { theme } = useContext(UiContext);
  return (
    <div
      className={cn(theme === "dark" && "prose-invert", "prose h-full max-w-[unset] leading-[1.4]")}
    >
      <div className="overflow-auto p-4 size-full">
        <TestMdx />
      </div>
    </div>
  );
}
