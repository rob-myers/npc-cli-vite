import { Dialog } from "@base-ui/react/dialog";
import { uiClassName } from "@npc-cli/ui-sdk/ui.store";
import { cn, Spinner, useStateRef } from "@npc-cli/util";
import { XIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
import type { PathManifest } from "./editor.schema";

export interface ParsedPath {
  d: string;
  name: string;
  svgWidth: number;
  svgHeight: number;
}

export function PathPickerModal({
  open,
  onOpenChange,
  onSelect,
  pathManifest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (paths: ParsedPath[]) => void;
  pathManifest: PathManifest | null;
}) {
  const state = useStateRef(() => ({
    loading: null as string | null,
    cachedBustingQuery: `t=${Date.now()}`,
    updateCacheBustingQuery() {
      state.cachedBustingQuery = `t=${Date.now()}`;
    },
  }));

  useEffect(() => {
    if (!open) state.loading = null;
    if (open && import.meta.env.DEV) state.updateCacheBustingQuery();
  }, [open]);

  const entries = pathManifest ? Object.values(pathManifest.byKey) : [];

  async function handleSelect(key: string, width: number, height: number) {
    state.set({ loading: key });
    try {
      const resp = await fetch(`/path/${key}.svg`);
      const text = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, "image/svg+xml");
      const pathEls = doc.querySelectorAll("svg > path");

      const paths: ParsedPath[] = [];
      for (const pathEl of pathEls) {
        const d = pathEl.getAttribute("d");
        if (!d) continue;
        const titleEl = pathEl.querySelector("title");
        const name = titleEl?.textContent?.trim() || key;
        paths.push({ d, name, svgWidth: width, svgHeight: height });
      }

      if (paths.length > 0) {
        onSelect(paths);
        onOpenChange(false);
      }
    } finally {
      state.set({ loading: null });
    }
  }

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
            <Dialog.Title className="text-sm font-semibold text-slate-200">Select Path SVG</Dialog.Title>
            <Dialog.Close className="p-1 hover:bg-slate-700 rounded transition-colors cursor-pointer">
              <XIcon className="size-5 text-slate-400" />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {entries.length === 0 ? (
              <div className="text-xs text-slate-500 italic">No path SVGs available</div>
            ) : (
              <div className="flex flex-wrap justify-center gap-3">
                {entries.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className="flex flex-col justify-center gap-1 p-2 bg-slate-800 rounded border border-slate-700 hover:border-blue-500 cursor-pointer"
                    onClick={() => handleSelect(entry.key, entry.width, entry.height)}
                    title={`${entry.key} (${entry.pathCount} path${entry.pathCount > 1 ? "s" : ""})`}
                    disabled={state.loading !== null}
                  >
                    <div className="h-full flex items-center justify-center min-h-16">
                      {state.loading === entry.key ? (
                        <Spinner />
                      ) : (
                        <img
                          src={`/path/${entry.filename}?${state.cachedBustingQuery}`}
                          alt={entry.key}
                          className="max-h-24 object-contain"
                        />
                      )}
                    </div>
                    <span className="text-[12px] text-slate-400 truncate w-full text-center">{entry.key}</span>
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
