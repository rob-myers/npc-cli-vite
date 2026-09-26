import { Dialog } from "@base-ui/react/dialog";
import { cn } from "@npc-cli/util";
import { XIcon } from "@phosphor-icons/react";
import About from "./about.mdx";
import { aboutComponents } from "./about-components";

export function AboutModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* above GlobalMenu's z-9999 */}
        <Dialog.Backdrop className="fixed inset-0 z-10000 bg-black/60" />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-10000 -translate-x-1/2 -translate-y-1/2",
            "max-w-lg w-[90vw] max-h-[80vh] flex flex-col rounded-lg overflow-hidden",
            "bg-neutral-900/70 border border-neutral-700 shadow-2xl shadow-black/50",
          )}
        >
          {/* as WorldMenu's panel */}
          <div className="flex items-center justify-between pl-3 pr-1.5 py-1.5 bg-neutral-800 border-b border-neutral-700">
            <Dialog.Title className="text-sm text-neutral-300">about</Dialog.Title>
            <Dialog.Close className="grid place-items-center size-9 rounded text-neutral-300 cursor-pointer hover:bg-neutral-700">
              <XIcon className="size-4" weight="bold" />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-thin p-4 flex flex-col gap-4 text-sm text-neutral-300">
            <About components={aboutComponents} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
