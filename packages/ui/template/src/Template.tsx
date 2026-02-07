import { uiClassName } from "@npc-cli/ui-sdk";
import { cn } from "@npc-cli/util";
import type { TemplateUiMeta } from "./schema";

export default function Template(_props: { meta: TemplateUiMeta }) {
  return (
    <div className="overflow-auto size-full flex justify-center items-center">
      <div
        className={cn(
          uiClassName,
          "bg-button-background text-on-background/70 border rounded px-4 py-2 text-center",
          "leading-4 transition-transform hover:scale-125 cursor-pointer",
        )}
      >
        Template Component
      </div>
    </div>
  );
}
