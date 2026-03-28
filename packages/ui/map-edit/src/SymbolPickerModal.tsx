import { Dialog } from "@base-ui/react/dialog";
import type { StarshipSymbolImageKey } from "@npc-cli/media/starship-symbol";
import { uiClassName } from "@npc-cli/ui-sdk/const";
import { cn, Spinner, useStateRef } from "@npc-cli/util";
import { XIcon } from "@phosphor-icons/react";
import { memo, useEffect } from "react";
import type { SymbolsManifest } from "./editor.schema";

export const SymbolPickerModalMemo = memo(SymbolPickerModal);

function SymbolPickerModal({
  open,
  onOpenChange,
  onSelect,
  symbolsManifest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (symbolKey: StarshipSymbolImageKey) => void;
  symbolsManifest: SymbolsManifest | null;
}) {
  const state = useStateRef(() => ({
    cachedBustingQuery: `t=${Date.now()}`,
    loadedImages: new Set<string>(),
    updateCacheBustingQuery() {
      state.cachedBustingQuery = `t=${Date.now()}`;
    },
  }));
  useEffect(() => {
    if (open && import.meta.env.DEV) state.updateCacheBustingQuery();
  }, [open]);

  const entries = symbolsManifest ? Object.values(symbolsManifest.byKey) : [];

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
                    className="flex flex-col justify-center gap-1 p-2 bg-slate-800 rounded border border-slate-700 hover:border-blue-500 cursor-pointer"
                    onClick={() => {
                      onSelect(entry.key);
                      onOpenChange(false);
                    }}
                    title={entry.filename}
                  >
                    <div className="h-full flex items-center justify-center">
                      <img
                        src={`/symbol/${entry.thumbnailFilename}?${state.cachedBustingQuery}`}
                        alt={entry.filename}
                        className={cn("max-h-24 object-contain", !state.loadedImages.has(entry.filename) && "hidden")}
                        onLoad={() => {
                          state.loadedImages.add(entry.filename);
                          state.update();
                        }}
                      />
                      {!state.loadedImages.has(entry.filename) && <Spinner />}
                    </div>
                    <span className="text-[12px] text-slate-400 truncate w-full text-center">
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
