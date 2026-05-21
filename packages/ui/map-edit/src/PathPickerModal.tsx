import { Dialog } from "@base-ui/react/dialog";
import { cn, Spinner, useStateRef } from "@npc-cli/util";
import { PencilSimpleIcon, XIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
import type { MapEditFileSpecifier, MapNode, PathManifest } from "./editor.schema";
import { PathEditorModal, type ProvidedPath } from "./PathEditorModal";

export interface ParsedPath {
  d: string;
  name: string;
  svgWidth: number;
  svgHeight: number;
}

export function PathPickerModal({
  fileSpecifier,
  open,
  pathManifest,
  selectedNode,
  onOpenChange,
  onSelect,
}: {
  fileSpecifier: MapEditFileSpecifier;
  open: boolean;
  pathManifest: PathManifest | null;
  selectedNode?: MapNode | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (paths: ParsedPath[]) => void;
}) {
  const state = useStateRef(() => ({
    loading: null as string | null,
    editorOpen: import.meta.hot?.data.__editorOpen ?? false,
    editorInitialPaths: undefined as ProvidedPath[] | undefined,
    editorInitialFilename: undefined as string | undefined,
    cachedBustingQuery: `t=${Date.now()}`,
    updateCacheBustingQuery() {
      state.cachedBustingQuery = `t=${Date.now()}`;
    },
  }));

  useEffect(() => {
    if (!open) {
      state.loading = null;
      state.editorOpen = false;
      if (import.meta.hot) import.meta.hot.data.__editorOpen = false;
    }
    if (open && import.meta.env.DEV) state.updateCacheBustingQuery();
  }, [open]);

  const canOpenSelection = selectedNode?.type === "path" || selectedNode?.type === "rect";

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

  async function handleEdit(key: string) {
    state.set({ loading: key });
    try {
      const resp = await fetch(`/path/${key}.svg`);
      const text = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, "image/svg+xml");
      const pathEls = doc.querySelectorAll("svg > path");

      const paths: ProvidedPath[] = [];
      for (const pathEl of pathEls) {
        const d = pathEl.getAttribute("d");
        if (!d) continue;
        const titleEl = pathEl.querySelector("title");
        paths.push({ d, title: titleEl?.textContent?.trim() || key, transform: "" });
      }

      // close then reopen to force reset with new data
      state.set({ editorOpen: false });
      requestAnimationFrame(() => {
        state.set({
          editorOpen: true,
          editorInitialPaths: paths.length > 0 ? paths : undefined,
          editorInitialFilename: key,
        });
      });
    } finally {
      state.set({ loading: null });
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Popup
          className={cn(
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

          {import.meta.env.DEV && (
            <div className="flex gap-2 px-4 py-2 border-b border-slate-700">
              <button
                type="button"
                className="px-3 py-1 text-xs rounded cursor-pointer bg-green-700 hover:bg-green-600 text-white"
                onClick={() =>
                  state.set({ editorOpen: true, editorInitialPaths: undefined, editorInitialFilename: undefined })
                }
              >
                Create Path
              </button>
              <button
                type="button"
                className={cn(
                  "px-3 py-1 text-xs rounded cursor-pointer bg-blue-700 hover:bg-blue-600 text-white",
                  !canOpenSelection && "opacity-50 pointer-events-none",
                )}
                onClick={() => {
                  if (!canOpenSelection || !selectedNode) return;
                  const { width, height } = selectedNode.baseRect;
                  const d =
                    selectedNode.type === "path"
                      ? selectedNode.d
                      : `M0,0 L${width},0 L${width},${height} L0,${height} Z`;
                  state.set({
                    editorOpen: true,
                    editorInitialPaths: [{ d, title: selectedNode.name, transform: selectedNode.cssTransform }],
                    editorInitialFilename: undefined,
                  });
                }}
              >
                Open selection
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4">
            {entries.length === 0 ? (
              <div className="text-xs text-slate-500 italic">No path SVGs available</div>
            ) : (
              <div className="flex flex-wrap justify-center gap-3">
                {entries.map((entry) => (
                  <div
                    key={entry.key}
                    className="relative p-2 bg-slate-800 rounded border border-slate-700 hover:border-blue-500"
                  >
                    <button
                      type="button"
                      className="cursor-pointer hover:opacity-80"
                      onClick={() => handleSelect(entry.key, entry.width, entry.height)}
                      title={`${entry.key} (${entry.pathCount} path${entry.pathCount > 1 ? "s" : ""})`}
                      disabled={state.loading !== null}
                    >
                      <div className="flex items-center justify-center min-h-16">
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
                      <span className="text-[12px] text-slate-400 truncate w-full text-center block">{entry.key}</span>
                    </button>
                    {import.meta.env.DEV && (
                      <button
                        type="button"
                        className="absolute top-1 right-1 p-1 rounded bg-slate-700/80 hover:bg-blue-600 cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(entry.key);
                        }}
                        title="Edit in path editor"
                      >
                        <PencilSimpleIcon className="size-3.5 text-white" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>

      <PathEditorModal
        fileSpecifier={fileSpecifier}
        initialFilename={state.editorInitialFilename}
        initialPaths={state.editorInitialPaths}
        open={state.editorOpen}
        onApply={(paths) => {
          onSelect(paths);
          onOpenChange(false);
        }}
        onOpenChange={(editorOpen) => {
          state.set({ editorOpen });
          if (import.meta.hot) import.meta.hot.data.__editorOpen = editorOpen;
        }}
      />
    </Dialog.Root>
  );
}
