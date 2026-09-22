import { Select } from "@base-ui/react/select";
import type { WorldState } from "@npc-cli/ui__world";
import { queryClientApi } from "@npc-cli/ui__world/query-client";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, useStateRef } from "@npc-cli/util";
import {
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  CaretDownIcon,
  CheckIcon,
  CursorIcon,
  SidebarSimpleIcon,
} from "@phosphor-icons/react";
import { useCallback, useContext, useEffect, useSyncExternalStore } from "react";
import { DecorLayer } from "./DecorLayer";
import { DecorSidebar } from "./DecorSidebar";
import { type DecorType, keysWithin, moved, newDef, nextKey, typeIcon } from "./decor-edit";
import { DecorHistory } from "./history";
import { NavMap2d } from "./NavMap2d";
import type { DecoratorUiMeta, NavMapLayer } from "./schema";

/** Places dynamic decor on a 2D top-down map of a live World — see `docs/decorator.md` */
export default function Decorator({ meta }: { meta: DecoratorUiMeta }) {
  const w = useWorld(meta.worldKey);

  if (w === undefined) {
    return (
      <div className="size-full grid place-items-center bg-slate-950 text-slate-400 text-sm">
        waiting for {meta.worldKey}…
      </div>
    );
  }

  // keyed by the state OBJECT: a World remade by HMR is a new one, and the editor starts over on it
  return <Editor key={epochOf(w)} w={w} meta={meta} />;
}

/**
 * The World's state, from the query cache it puts itself in under its key. Read off the cache's
 * own events rather than `useQuery`: the World REMOVES its query on unmount and sets a new one on
 * remount, e.g. over HMR, and an observer of the removed one would wait forever
 */
function useWorld(worldKey: string): WorldState | undefined {
  const subscribe = useCallback((onChange: () => void) => queryClientApi.queryCache.subscribe(onChange), []);
  return useSyncExternalStore(subscribe, () => {
    const w = queryClientApi.get([worldKey]) as WorldState | undefined;
    // `undefined` until it has geomorphs: the same object either side would not re-render
    return w !== undefined && w.gms.length > 0 ? w : undefined;
  });
}

const epochs = new WeakMap<WorldState, number>();
let nextEpoch = 0;
function epochOf(w: WorldState) {
  const epoch = epochs.get(w) ?? nextEpoch++;
  epochs.set(w, epoch);
  return `${w.key}:${epoch}`;
}

/** The panel proper, once there is a World */
function Editor({ w, meta }: { w: WorldState; meta: DecoratorUiMeta }) {
  const { uiStoreApi } = useContext(UiContext);

  const state = useStateRef(
    (): State => ({
      /** The npcs there were when the picker was last opened: it need not keep up */
      npcOptions: [],
      selected: [],
      history: new DecorHistory(w),
      tool: "select",
      /** For the point and quad tools */
      img: undefined,
      tilt: true,

      select(keys) {
        state.selected = keys.filter((key) => key in w.decor.runtime.byKey);
        state.update();
      },
      setTool(tool) {
        state.set({ tool: state.tool === tool ? "select" : tool });
      },
      commit(defs) {
        state.history.mark();
        for (const def of defs) w.decor.create(def);
        w.view.forceUpdate();
      },
      remove(keys) {
        if (keys.length === 0) return;
        state.history.mark();
        w.decor.remove(...keys);
        state.select([]);
      },
      rename(key, next) {
        state.history.mark();
        if (w.decor.rename(key, next) === false) return state.history.past.pop();
        state.select(state.selected.map((k) => (k === key ? next : k)));
      },
      undo() {
        state.history.undo() && state.select(state.selected);
      },
      redo() {
        state.history.redo() && state.select(state.selected);
      },
      setSidebar(patch) {
        uiStoreApi.setUiMeta(meta.id, (draft) => void Object.assign(draft as DecoratorUiMeta, patch));
      },
      onSidebarResizeStart(e) {
        e.stopPropagation();
        e.preventDefault(); // else the drag selects text across the list
        const startX = e.clientX;
        const startWidth = meta.sidebarOpen ? meta.sidebarWidth : 0;
        const onMove = (ev: MouseEvent) => {
          const width = startWidth + ev.clientX - startX;
          // dragged in past its narrowest it closes; dragged out again it opens, at that width
          if (width < minSidebarWidth / 2) meta.sidebarOpen && state.setSidebar({ sidebarOpen: false });
          else state.setSidebar({ sidebarOpen: true, sidebarWidth: Math.max(minSidebarWidth, width) });
        };
        const onUp = () => {
          document.body.style.userSelect = "";
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        document.body.style.userSelect = "none";
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      },
      onMapClick(at) {
        if (state.tool === "select") return state.select([]);
        const def = newDef(w, state.tool, nextKey(w, state.tool), at, { img: state.img, tilt: state.tilt });
        state.commit([def]);
        state.select([def.key]);
      },
      onKeyDown(e) {
        if ((e.target as HTMLElement).tagName === "INPUT") return;
        const nudge = e.shiftKey ? 0.5 : 0.1;
        const arrows: Record<string, [number, number]> = {
          ArrowLeft: [-nudge, 0],
          ArrowRight: [nudge, 0],
          ArrowUp: [0, -nudge],
          ArrowDown: [0, nudge],
        };
        if (e.key in arrows) {
          e.preventDefault();
          const [dx, dy] = arrows[e.key];
          state.commit(state.selected.map((key) => moved(w.decor.runtime.defByKey[key], dx, dy)));
        } else if (e.key === "Delete" || e.key === "Backspace") {
          state.remove(state.selected);
        } else if ((e.key === "z" || e.key === "Z") && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          e.shiftKey ? state.redo() : state.undo();
        } else if (e.key === "y" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          state.redo();
        } else if (e.key === "Escape") {
          state.tool === "select" ? state.select([]) : state.set({ tool: "select" });
        } else if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          state.select(Object.keys(w.decor.runtime.byKey));
        }
      },

      onNpcsOpenChange(open) {
        if (open === false) return;
        const npcKeys = Object.keys(w.n ?? {});
        state.npcOptions = npcKeys;
        // those gone since are dropped
        state.setNpcKeys(meta.npcKeys.filter((npcKey) => npcKeys.includes(npcKey)));
      },
      setNpcKeys(npcKeys) {
        uiStoreApi.setUiMeta(meta.id, (draft) => void ((draft as DecoratorUiMeta).npcKeys = npcKeys));
      },
      toggleLayer(layer) {
        uiStoreApi.setUiMeta(meta.id, (draft) => {
          const { show } = draft as DecoratorUiMeta;
          show[layer] = !show[layer];
        });
      },
    }),
    { deps: [w, meta.npcKeys, meta.sidebarWidth, meta.sidebarOpen], reset: { history: false } },
  );

  useEffect(() => {
    // what the map is drawn from changes under it
    const sub = w.events.subscribe({
      next(e) {
        // `create` removes first: only drop what is still gone once its re-create has landed
        if (e.key === "decor-removed") queueMicrotask(() => state.select(state.selected));
        if (redrawOn.has(e.key)) state.update();
      },
    });
    return () => sub.unsubscribe();
  }, [w]);

  return (
    <div
      className="size-full flex flex-col bg-slate-950 text-slate-300 text-xs outline-none"
      tabIndex={0}
      onKeyDown={state.onKeyDown}
    >
      <div className="flex items-center gap-1 px-2 py-1 border-b border-slate-800">
        <span className="text-slate-500 pr-2">
          {meta.worldKey} · {w.mapKey}
        </span>
        <ToolButton
          icon={SidebarSimpleIcon}
          title={meta.sidebarOpen ? "hide the list" : "show the list"}
          active={meta.sidebarOpen}
          onClick={() => state.setSidebar({ sidebarOpen: !meta.sidebarOpen })}
        />
        <span className="w-px h-4 mx-1 bg-slate-800" />
        {/* the tools: select, or add one of each type where the map is clicked */}
        <ToolButton
          icon={CursorIcon}
          title="select (Esc)"
          active={state.tool === "select"}
          onClick={() => state.setTool("select")}
        />
        {decorTypes.map((type) => (
          <ToolButton
            key={type}
            icon={typeIcon[type]}
            title={`add ${type}`}
            active={state.tool === type}
            onClick={() => state.setTool(type)}
          />
        ))}
        {(state.tool === "point" || state.tool === "quad") && (
          <select
            className="px-1 py-0.5 rounded border border-slate-800 bg-slate-950 outline-none"
            value={state.img ?? ""}
            onChange={(e) => state.set({ img: e.currentTarget.value === "" ? undefined : e.currentTarget.value })}
          >
            {state.tool === "point" && <option value="">no image</option>}
            {Object.keys(w.sheets?.decor ?? {}).map((img) => (
              <option key={img} value={img}>
                {img}
              </option>
            ))}
          </select>
        )}
        {state.tool === "quad" && (
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={state.tilt}
              onChange={(e) => state.set({ tilt: e.currentTarget.checked })}
            />
            tilt
          </label>
        )}
        <span className="w-px h-4 mx-1 bg-slate-800" />
        <ToolButton icon={ArrowUUpLeftIcon} title="undo (cmd-Z)" active={false} onClick={state.undo} />
        <ToolButton icon={ArrowUUpRightIcon} title="redo (shift-cmd-Z)" active={false} onClick={state.redo} />
        <span className="w-px h-4 mx-1 bg-slate-800" />
        {layers.map((layer) => (
          <button
            key={layer}
            type="button"
            className={cn(
              "px-2 py-0.5 rounded border cursor-pointer",
              meta.show[layer] ? "border-slate-500 text-slate-200 bg-slate-800" : "border-slate-800 text-slate-500",
            )}
            onClick={() => state.toggleLayer(layer)}
          >
            {layer}
          </button>
        ))}

        <Select.Root
          multiple
          value={meta.npcKeys}
          onValueChange={state.setNpcKeys}
          onOpenChange={state.onNpcsOpenChange}
        >
          <Select.Trigger className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded border border-slate-800 cursor-pointer hover:bg-slate-800">
            <Select.Value>{(npcKeys: string[]) => (npcKeys.length === 0 ? "npcs" : npcKeys.join(", "))}</Select.Value>
            <CaretDownIcon className="size-3" />
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner className="z-50" sideOffset={4} align="end" alignItemWithTrigger={false}>
              <Select.Popup className="bg-slate-800 border border-slate-700 rounded shadow-lg py-1 max-h-60 overflow-auto text-xs text-slate-300">
                {state.npcOptions.length === 0 && <div className="px-3 py-1 text-slate-500">no npcs</div>}
                {state.npcOptions.map((npcKey) => (
                  <Select.Item
                    key={npcKey}
                    value={npcKey}
                    className="flex items-center gap-2 px-3 py-1 cursor-pointer data-highlighted:bg-slate-700"
                  >
                    <Select.ItemIndicator className="w-3">
                      <CheckIcon className="size-3" />
                    </Select.ItemIndicator>
                    <Select.ItemText>{npcKey}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      </div>

      <div className="flex-1 min-h-0 flex">
        {meta.sidebarOpen && (
          <div className="relative shrink-0 flex" style={{ width: meta.sidebarWidth }}>
            <DecorSidebar
              w={w}
              selected={state.selected}
              onSelect={state.select}
              onRename={state.rename}
              onShowIn3d={(key) => {
                const d = w.decor.runtime.byKey[key];
                if (d !== undefined) void w.view.lookAt(d.type === "point" ? d : d.center, { animate: true });
              }}
            />
          </div>
        )}
        {/* drag the list's edge to resize it — in past its narrowest to close it, and out again to open */}
        <div
          className="shrink-0 w-1.5 -ml-0.5 cursor-col-resize hover:bg-slate-700/60 select-none"
          onMouseDown={state.onSidebarResizeStart}
        />
        <div className="flex-1 min-w-0">
          <NavMap2d
            key={w.mapKey} // remade per map: it reads where that map was left, and saves there
            w={w}
            show={meta.show}
            npcKeys={meta.npcKeys}
            cursor={state.tool === "select" ? undefined : "crosshair"}
            onClick={state.onMapClick}
            onMarquee={(rect, e) =>
              state.select(e.shiftKey ? [...new Set([...state.selected, ...keysWithin(w, rect)])] : keysWithin(w, rect))
            }
          >
            <DecorLayer
              w={w}
              selected={state.selected}
              showStatic={meta.show.static}
              onSelect={state.select}
              onCommit={state.commit}
            />
          </NavMap2d>
        </div>
      </div>
    </div>
  );
}

function ToolButton(props: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  active: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      title={props.title}
      className={cn(
        "grid place-items-center size-6 rounded border cursor-pointer",
        props.active
          ? "border-slate-400 text-slate-100 bg-slate-700"
          : "border-slate-800 text-slate-500 hover:bg-slate-800",
      )}
      onClick={props.onClick}
    >
      <props.icon className="size-3.5" />
    </button>
  );
}

type State = {
  npcOptions: string[];
  selected: string[];
  history: DecorHistory;
  tool: "select" | DecorType;
  img: string | undefined;
  tilt: boolean;
  select(keys: string[]): void;
  setTool(tool: "select" | DecorType): void;
  /** Each def replaces its decor, which the World persists; every edit is undoable */
  commit(defs: Geomorph.DecorDef[]): void;
  remove(keys: string[]): void;
  rename(key: string, next: string): void;
  undo(): void;
  redo(): void;
  setSidebar(patch: Partial<Pick<DecoratorUiMeta, "sidebarWidth" | "sidebarOpen">>): void;
  onSidebarResizeStart(e: React.MouseEvent): void;
  onMapClick(at: Geom.VectJson): void;
  onKeyDown(e: React.KeyboardEvent): void;
  onNpcsOpenChange(open: boolean): void;
  setNpcKeys(npcKeys: string[]): void;
  toggleLayer(layer: NavMapLayer): void;
};

const layers: NavMapLayer[] = ["nav", "labels", "obstacles", "grid", "static"];
const decorTypes: DecorType[] = ["point", "rect", "circle", "quad"];
const minSidebarWidth = 120;

/** The events after which the map looks different */
const redrawOn = new Set<string>([
  "map-settled",
  "nav-updated",
  "decor-ready",
  "decor-created",
  "decor-removed",
  "door-open",
  "door-closed",
  "door-locked",
  "door-unlocked",
]);
