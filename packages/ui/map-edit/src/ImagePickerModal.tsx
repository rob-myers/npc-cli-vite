import { Dialog } from "@base-ui/react/dialog";
import { type StarshipSymbolGroup, type StarshipSymbolImageKey, symbolByGroup } from "@npc-cli/media/starship-symbol";
import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, Spinner, useStateRef } from "@npc-cli/util";
import { XIcon } from "@phosphor-icons/react";

export function ImagePickerModal({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (imageKey: StarshipSymbolImageKey) => void;
}) {
  const state = useStateRef(() => {
    const groups = Object.entries(symbolByGroup);
    const savedGroup = localStorage.getItem(localStorageKey);
    const firstGroup = (groups[0]?.[0] ?? null) as StarshipSymbolGroup | null;
    return {
      groups,
      expandedGroup: savedGroup && savedGroup in symbolByGroup ? savedGroup : firstGroup,
      loadedImages: new Set<string>(),
    };
  });

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
            <Dialog.Title className="text-sm font-semibold text-slate-200">Select Image</Dialog.Title>
            <Dialog.Close className="p-1 hover:bg-slate-700 rounded transition-colors cursor-pointer">
              <XIcon className="size-5 text-slate-400" />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {state.groups.map(([group, symbols]) => (
              <div key={group} className="mb-4">
                <button
                  type="button"
                  className="w-full text-left text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 hover:text-slate-200 transition-colors cursor-pointer"
                  onClick={() => {
                    const next = state.expandedGroup === group ? null : group;
                    state.expandedGroup = next;
                    if (next !== null) {
                      localStorage.setItem(localStorageKey, next);
                    }
                    state.update();
                  }}
                >
                  {group} ({Object.keys(symbols).length})
                </button>

                {state.expandedGroup === group && (
                  <div
                    ref={(el) => el?.scrollIntoView({ block: "center", behavior: "smooth" })}
                    className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2"
                  >
                    {Object.keys(symbols).map((imageKey) => (
                      <button
                        key={imageKey}
                        type="button"
                        className="aspect-square bg-slate-800 rounded border border-slate-700 hover:border-blue-500 transition-colors overflow-hidden cursor-pointer"
                        onClick={() => {
                          onSelect(imageKey as StarshipSymbolImageKey);
                          onOpenChange(false);
                        }}
                        title={imageKey}
                      >
                        <img
                          src={`/starship-symbol/${imageKey}.png`}
                          alt={imageKey}
                          className={cn("size-full object-contain", !state.loadedImages.has(imageKey) && "hidden")}
                          onLoad={() => {
                            state.loadedImages.add(imageKey);
                            state.update();
                          }}
                          // loading="lazy"
                        />

                        {!state.loadedImages.has(imageKey) && <Spinner />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const localStorageKey = "imagePickerModal.lastSection";
