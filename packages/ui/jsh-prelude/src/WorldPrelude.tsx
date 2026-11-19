import { Dialog } from "@base-ui/react/dialog";
import { cn } from "@npc-cli/util";
import { ListBulletsIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { PreludeEntries } from "./PreludeEntries";
import { preludeApi, usePrelude } from "./store";

/** In a World's paused pill: the auto-boot switch, and a button showing what it runs */
export function WorldPrelude({
  worldKey,
  container,
  booting,
}: {
  worldKey: string;
  /** The World's panel, which holds the modal */
  container: null | HTMLElement;
  booting: boolean;
}) {
  const { autoBoot, entries } = usePrelude(worldKey);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-3 font-mono text-xs tracking-wider text-white/70 opacity-60 hover:opacity-100 transition-opacity">
      <button
        type="button"
        role="switch"
        aria-checked={autoBoot}
        disabled={booting}
        className="group flex items-center gap-2 cursor-pointer hover:text-white disabled:opacity-50"
        onClick={() => preludeApi.setAutoBoot(worldKey, !autoBoot)}
      >
        auto-boot
        <span
          className={cn(
            "flex items-center w-7 h-4 p-0.5 rounded-full border transition-colors",
            autoBoot ? "border-white/70 bg-white/25" : "border-white/30 bg-black",
          )}
        >
          <span
            className={cn(
              "size-2.5 rounded-full transition-transform",
              autoBoot ? "translate-x-3 bg-white" : "bg-white/40 group-hover:bg-white/60",
            )}
          />
        </span>
      </button>
      <button
        type="button"
        title="what auto-boot runs"
        disabled={booting}
        className="flex items-center gap-1 cursor-pointer hover:text-white disabled:opacity-50"
        onClick={() => setOpen(true)}
      >
        <ListBulletsIcon className="size-3.5" />
        {entries.length}
      </button>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal container={container}>
          <Dialog.Backdrop className="absolute inset-0 z-50 bg-black/60" />
          <Dialog.Popup
            className={cn(
              "absolute left-1/2 top-[10%] z-50 -translate-x-1/2 w-[90%] max-w-md max-h-[80%] flex flex-col",
              "rounded-lg border border-term-border bg-background font-sans text-on-background shadow-2xl outline-none",
            )}
            // the World's keys are not for the dialog. Base UI closes it on Escape from the document
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-term-border-subtle">
              <div className="flex-1 min-w-0">
                <Dialog.Title className="text-base font-medium">Auto-boot</Dialog.Title>
                <Dialog.Description className="mt-1.5 text-sm text-term-muted leading-snug">
                  Runs in order before {worldKey} first plays.
                </Dialog.Description>
              </div>
              <Dialog.Close className="-mr-1.5 p-1 rounded cursor-pointer text-term-muted hover:bg-term-hover">
                <XIcon className="size-4" />
              </Dialog.Close>
            </div>
            <div className="min-h-0 overflow-y-auto scrollbar-thin py-2">
              <PreludeEntries worldKey={worldKey} />
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
