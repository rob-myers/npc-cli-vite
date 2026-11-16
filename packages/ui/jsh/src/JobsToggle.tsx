import type { UiInstanceMeta } from "@npc-cli/ui-sdk";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn } from "@npc-cli/util";
import { useContext } from "react";
import { type JshUiMeta, JshUiSchema } from "./schema";

/** Beside its tab's dots: shows or hides the tty's jobs */
export function JobsToggle({ meta }: { meta: UiInstanceMeta }) {
  const { uiStoreApi } = useContext(UiContext);
  const jobs = JshUiSchema.shape.jobs.parse((meta as JshUiMeta).jobs);
  return (
    <button
      type="button"
      title={jobs.shown ? "hide jobs" : "show jobs"}
      className={cn(
        "mr-1 px-1 text-xs cursor-pointer",
        jobs.shown ? "text-on-background" : "text-on-background/50 hover:text-on-background/80",
      )}
      onClick={(e) => {
        e.stopPropagation();
        uiStoreApi.setUiMeta(meta.id, (draft) => void ((draft as JshUiMeta).jobs = { ...jobs, shown: !jobs.shown }));
      }}
    >
      jobs
    </button>
  );
}
