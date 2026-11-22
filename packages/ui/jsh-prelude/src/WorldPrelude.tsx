import { Dialog } from "@base-ui/react/dialog";
import { cn, Tip } from "@npc-cli/util";
import { ArrowsClockwiseIcon, ListBulletsIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { PreludeEntries } from "./PreludeEntries";
import { preludeApi, usePrelude } from "./store";

/** In a World's paused pill: the autorun switch, a button showing what it runs, and reboot */
export function WorldPrelude({
  worldKey,
  container,
  booting,
  onReboot,
}: {
  worldKey: string;
  /** The World's panel, which holds the modal */
  container: null | HTMLElement;
  booting: boolean;
  onReboot?(): void;
}) {
  const { autorun, entries } = usePrelude(worldKey);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-3 font-mono text-xs tracking-wider text-white/70 opacity-60 hover:opacity-100 transition-opacity">
      <Tip side="bottom" content="runs marked SkipNet code">
        <button
          type="button"
          role="switch"
          aria-checked={autorun}
          disabled={booting}
          className="group flex items-center gap-2 cursor-pointer hover:text-white disabled:opacity-50"
          onClick={() => preludeApi.setAutorun(worldKey, !autorun)}
        >
          autorun
          <span
            className={cn(
              "flex items-center w-7 h-4 p-0.5 rounded-full border transition-colors",
              autorun ? "border-emerald-400/70 bg-emerald-400/25" : "border-white/30 bg-black",
            )}
          >
            <span
              className={cn(
                "size-2.5 rounded-full transition-transform",
                autorun ? "translate-x-3 bg-emerald-300" : "bg-white/40 group-hover:bg-white/60",
              )}
            />
          </span>
        </button>
      </Tip>
      <Tip side="bottom" content="what autoruns">
        <button
          type="button"
          disabled={booting}
          className="flex items-center gap-1 cursor-pointer hover:text-white disabled:opacity-50"
          onClick={() => setOpen(true)}
        >
          <ListBulletsIcon className="size-3.5" />
          {entries.length}
        </button>
      </Tip>
      {onReboot !== undefined && <RebootButton disabled={booting} onReboot={onReboot} />}

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
                <Dialog.Title className="text-base font-medium">Autorun</Dialog.Title>
                <Dialog.Description className="mt-1.5 text-sm text-term-muted leading-snug">
                  Runs marked SkipNet code for {worldKey}.
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

/** Reboot, once confirmed by a second press within `confirmMs` */
function RebootButton({ disabled, onReboot }: { disabled: boolean; onReboot(): void }) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (confirming === false) return;
    const timeoutId = window.setTimeout(() => setConfirming(false), confirmMs);
    return () => window.clearTimeout(timeoutId);
  }, [confirming]);

  return (
    <Tip side="bottom" content={confirming ? "press again to reboot" : "reboot all world-related code"}>
      <button
        type="button"
        disabled={disabled}
        className={cn(
          "flex items-center h-5 rounded-full cursor-pointer disabled:opacity-50",
          "ring-1 transition-[padding,color,box-shadow] duration-200",
          confirming ? "px-1.5 text-amber-300 ring-amber-300/70 animate-pulse" : "ring-transparent hover:text-white",
        )}
        onClick={() => {
          setConfirming(!confirming);
          confirming && onReboot();
        }}
      >
        <ArrowsClockwiseIcon className="size-3.5" weight={confirming ? "bold" : "regular"} />
        {/* grows from no width, so it slides in rather than appearing */}
        <span
          className={cn(
            "grid transition-[grid-template-columns,opacity] duration-200",
            confirming ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0",
          )}
        >
          <span className="overflow-hidden">
            <span className="whitespace-nowrap pl-1">confirm</span>
          </span>
        </span>
      </button>
    </Tip>
  );
}

const confirmMs = 3000;
