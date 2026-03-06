import { Dialog } from "@base-ui/react/dialog";
import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, Spinner, useStateRef } from "@npc-cli/util";
import { XIcon } from "@phosphor-icons/react";

import type { SymbolsManifest } from "./map-node-api";

export function SymbolPickerModal({
  open,
  onOpenChange,
  onSelect,
  symbolsManifest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (symbolKey: string) => void;
  symbolsManifest: SymbolsManifest | null;
}) {
  const state = useStateRef(() => ({
    loadedImages: new Set<string>(),
  }));

  const entries = symbolsManifest ? Object.values(symbolsManifest.byFilename) : [];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={cn(uiClassName, "fixed inset-0 z-50 bg-black/60")} />
        <Dialog.Popup
          className={cn(
            uiClassName,
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "bg-slate-900 border border-slate-700 rounded-lg shadow-2xl",
            "max-w-3xl w-[90vw] max-h-[80vh] flex flex-col",
          )}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <Dialog.Title className="text-sm font-semibold text-slate-200">Select Symbol</Dialog.Title>
            <Dialog.Close className="p-1 hover:bg-slate-700 rounded transition-colors cursor-pointer">
              <XIcon className="size-5 text-slate-400" />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {entries.length === 0 ? (
              <div className="text-xs text-slate-500 italic">No symbols available</div>
            ) : (
              <div className="flex flex-wrap justify-center sm:grid-cols-4 md:grid-cols-5 gap-3">
                {entries.map((entry) => (
                  <button
                    key={entry.filename}
                    type="button"
                    className="flex flex-col items-center gap-1 p-2 bg-slate-800 rounded border border-slate-700 hover:border-blue-500 transition-colors cursor-pointer"
                    onClick={() => {
                      onSelect(entry.filename.replace(/\.json$/, ""));
                      onOpenChange(false);
                    }}
                    title={entry.filename}
                  >
                    <div className="w-full aspect-square flex items-center justify-center overflow-hidden">
                      <img
                        src={invalidateImageCacheInDev(`/symbol/${entry.thumbnailFilename}`)}
                        alt={entry.filename}
                        className={cn(
                          "max-w-full max-h-full object-contain",
                          !state.loadedImages.has(entry.filename) && "hidden",
                        )}
                        onLoad={() => {
                          state.loadedImages.add(entry.filename);
                          state.update();
                        }}
                      />
                      {!state.loadedImages.has(entry.filename) && <Spinner />}
                    </div>
                    <span className="text-[10px] text-slate-400 truncate w-full text-center">
                      {entry.filename.replace(/\.json$/, "")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function invalidateImageCacheInDev(url: string) {
  return `${url}?t=${Date.now()}`;
}
