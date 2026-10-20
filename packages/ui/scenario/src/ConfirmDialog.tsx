import { Dialog } from "@base-ui/react/dialog";

/** A yes or no, drawn inside the panel (`container`) */
export function ConfirmDialog({ container, open, text, yes, onOpenChange, onYes }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Backdrop className="absolute inset-0 z-20 bg-black/60" />
        <Dialog.Popup className="absolute left-1/2 top-1/3 z-20 -translate-x-1/2 w-72 max-w-[90%] flex flex-col gap-3 p-3 rounded-lg border border-zinc-700 bg-zinc-950 text-zinc-300 text-xs">
          <Dialog.Title className="text-zinc-100">{text}</Dialog.Title>
          <div className="flex justify-end gap-2">
            <Dialog.Close className="px-2 py-1 rounded border border-zinc-700 cursor-pointer hover:bg-zinc-800">
              cancel
            </Dialog.Close>
            <button
              type="button"
              className="px-2 py-1 rounded border border-zinc-500 text-zinc-100 cursor-pointer hover:bg-zinc-800"
              onClick={onYes}
            >
              {yes}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type Props = {
  container: null | HTMLElement;
  open: boolean;
  text: string;
  yes: string;
  onOpenChange(open: boolean): void;
  onYes(): void;
};
