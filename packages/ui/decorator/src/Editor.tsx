import { Menu } from "@base-ui/react/menu";
import { manifestShared, useManifestLoreCharacters, useManifestShared } from "@npc-cli/ui__manifest/shared";
import type { WorldState } from "@npc-cli/ui__world";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, useStateRef } from "@npc-cli/util";
import { Picker as BasePicker } from "@npc-cli/util/picker";
import {
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  CaretDownIcon,
  EyeIcon,
  EyeSlashIcon,
  SidebarSimpleIcon,
} from "@phosphor-icons/react";
import { useContext, useEffect, useRef } from "react";
import { DecorLayer } from "./DecorLayer";
import { DecorMenu, NumberInput } from "./DecorMenu";
import { DecorSidebar } from "./DecorSidebar";
import {
  type DecorType,
  hasHeight,
  keysWithin,
  locateZoom,
  moved,
  newDef,
  nextKey,
  tiltedQuadHeight,
  withHeight,
} from "./decor-edit";
import { DecorHistory, mergeKey } from "./history";
import { ManifestLoreLayer } from "./ManifestLoreLayer";
import { NavMap2d, type NavMap2dApi } from "./NavMap2d";
import type { DecoratorUiMeta, NavMapLayer } from "./schema";

/** The map pane, once there is a World */
export function Editor(props: { w: WorldState; meta: DecoratorUiMeta }) {
  const { w, meta } = props;
  const map = useRef<NavMap2dApi>(null);
  /** What a Manifest on this World shows, should there be one: its entry is drawn on the map */
  const shared = useManifestShared(meta.worldKey);
  const manifestLore = shared.entry;
  /** Each can be spawned, with their skin and their doors */
  const characters = useManifestLoreCharacters(manifestLore);
  const { uiStoreApi } = useContext(UiContext);

  const state = useStateRef(
    (): State => ({
      selected: [],
      history: new DecorHistory(w),
      tool: "select",
      spawning: null,
      spawnError: null,
      /** For the point and quad tools */
      img: undefined,
      tilt: true,
      /** For the point and quad tools: `undefined` is their default */
      y3d: undefined,
      menuOpen: false,
      /** `performance.now()` before which no context menu opens: `Infinity` whilst a press is under way */
      menuBlockedUntil: 0,

      select(keys) {
        state.selected = keys.filter((key) => key in w.decor.runtime.byKey);
        state.update();
      },
      commit(defs, merge) {
        state.history.mark(merge);
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
      selectedWithHeight() {
        return state.selected
          .map((key) => w.decor.runtime.defByKey[key])
          .filter((d) => d !== undefined && hasHeight(d));
      },
      heightShown() {
        return state.tool === "point" || state.tool === "quad" || state.selectedWithHeight().length > 0;
      },
      heightValue() {
        if (state.tool !== "select") return state.y3d;
        const ys = new Set(state.selectedWithHeight().map((def) => def.y3d)); // the selection's, when they agree
        return ys.size === 1 ? [...ys][0] : undefined;
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
      onPressing(pressing) {
        // some platforms raise a ctrl or right click's menu after `pointerup`
        state.menuBlockedUntil = pressing ? Number.POSITIVE_INFINITY : performance.now() + menuAfterUpMs;
      },
      isMenuBlocked() {
        return performance.now() < state.menuBlockedUntil;
      },
      async spawnNpc(npcKey, at) {
        // theirs, should the lore have them: its skin and its doors
        const { skin, maps } = characters.find((x) => x.npcKey === npcKey) ?? {};
        try {
          const hasSkin = skin !== undefined && w.npc.getSkinIndexBySkinKey(skin) !== -1;
          await w.npc.spawn({ npcKey, at, as: hasSkin ? skin : undefined });
          if (hasSkin) w.n[npcKey]?.setSkin(skin); // a respawn keeps the old one
          for (const gdKey of maps?.[w.mapKey]?.doors ?? []) {
            if (gdKey in w.door.byKey) w.e.setAccess(npcKey, gdKey as Geomorph.GmDoorKey, true);
          }
          w.view.forceUpdate();
          if (meta.npcKeys.includes(npcKey) === false) state.setNpcKeys([...meta.npcKeys, npcKey]);
          state.set({ spawning: null, spawnError: null });
        } catch (e) {
          state.set({ spawnError: e instanceof Error ? e.message : String(e) });
        }
      },
      onMapClick(at) {
        if (state.menuOpen) return; // a long press let go
        if (state.spawning !== null) return void state.spawnNpc(state.spawning, at);
        if (state.tool === "select") return state.select([]);
        state.add(state.tool, at);
      },
      add(type, at) {
        const def = newDef(w, type, nextKey(w, type), at, { img: state.img, tilt: state.tilt, y3d: state.y3d });
        state.commit([def]);
        state.select([def.key]);
      },
      setHeight(y3d, stepped) {
        const defs = state.selectedWithHeight();
        if (state.tool === "select" && defs.length > 0) {
          state.commit(
            defs.map((def) => withHeight(def, y3d)),
            mergeKey(stepped === true, state.selected, "y3d"),
          );
        } else {
          state.set({ y3d });
        }
      },
      onKeyDown(e) {
        const el = e.target as HTMLElement;
        // the menu is portalled, yet its keys bubble here through React
        if (["INPUT", "SELECT"].includes(el.tagName) || el.closest('[role="menu"]') !== null) return;
        const toolKey = e.metaKey || e.ctrlKey || e.altKey ? undefined : toolByKey[e.key.toLowerCase()];
        if (toolKey !== undefined) return state.set({ tool: toolKey });
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
          if (state.spawning !== null) state.set({ spawning: null, spawnError: null });
          else state.tool === "select" ? state.select([]) : state.set({ tool: "select" });
        } else if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          state.select(Object.keys(w.decor.runtime.byKey));
        }
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
    { deps: [w, meta.npcKeys, meta.sidebarWidth, meta.sidebarOpen, characters], reset: { history: false } },
  );

  /** The lore's characters first, then whoever else is in the World */
  const npcKeys = [...new Set([...characters.map((x) => x.npcKey), ...Object.keys(w.n ?? {})])];

  // a Manifest shows the entry of whoever was last chosen here
  const mapNpcKey = meta.npcKeys[meta.npcKeys.length - 1] ?? null;
  useEffect(() => {
    manifestShared.set(meta.worldKey, { npcKey: mapNpcKey });
  }, [meta.worldKey, mapNpcKey]);

  // ...and asks for the map to be centred on its entry's npc, else its first room
  useEffect(() => {
    if (shared.locate !== null) map.current?.centreOn(shared.locate.x, shared.locate.y, locateZoom);
  }, [shared.locate]);

  // ...and whoever it renames is followed here under their new key
  useEffect(() => {
    const { renamed } = shared;
    if (renamed === null || meta.npcKeys.includes(renamed.from) === false) return;
    state.setNpcKeys(meta.npcKeys.flatMap((key) => (key !== renamed.from ? key : (renamed.to ?? []))));
  }, [shared.renamed]);

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
      className="size-full flex flex-col bg-zinc-950 text-zinc-300 text-xs outline-none"
      tabIndex={0}
      onKeyDown={state.onKeyDown}
    >
      {/* one line, whatever the tools show: it scrolls sideways rather than wrapping */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-800 overflow-x-auto scrollbar-thin whitespace-nowrap *:shrink-0">
        <span className="text-zinc-500 pr-2">
          {meta.worldKey} · {w.mapKey}
        </span>
        {state.spawnError !== null && <span className="text-red-400">{state.spawnError}</span>}
        <ToolButton
          icon={SidebarSimpleIcon}
          title={meta.sidebarOpen ? "hide the list" : "show the list"}
          active={meta.sidebarOpen}
          onClick={() => state.setSidebar({ sidebarOpen: !meta.sidebarOpen })}
        />
        <span className="w-px h-4 mx-1 bg-zinc-800" />
        {/* the tool: select, or add one of a type where the map is clicked */}
        <Picker
          title="tool: select (V, Esc), or add a point (P), rect (R), circle (C) or quad (Q)"
          value={state.tool}
          options={tools}
          // fixed, as each select here is: the bar keeps still as what is chosen changes
          className={cn("w-18 justify-between", state.tool !== "select" && "border-zinc-400 text-zinc-100")}
          onChange={(tool) => state.set({ tool })}
        />
        {(state.tool === "point" || state.tool === "quad") && (
          <Picker
            value={state.img ?? ""}
            options={[
              ...(state.tool === "point" ? [{ value: "", label: "no image" }] : []),
              ...Object.keys(w.sheets?.decor ?? {}),
            ]}
            className="w-32 justify-between"
            onChange={(img) => state.set({ img: img === "" ? undefined : img })}
          />
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
        {state.heightShown() && (
          <label className="flex items-stretch" title="height off the floor (m)">
            <span className="grid place-items-center px-1.5 rounded-l border border-r-0 border-zinc-700 bg-zinc-900 text-zinc-500">
              h
            </span>
            <NumberInput
              className="rounded-l-none"
              value={state.heightValue()}
              placeholder={state.tool === "quad" && state.tilt ? String(tiltedQuadHeight) : "0"}
              onCommit={state.setHeight}
            />
          </label>
        )}
        <NpcsMenu
          npcKeys={npcKeys}
          spawned={Object.keys(w.n ?? {})}
          shown={meta.npcKeys}
          spawning={state.spawning}
          onOpen={state.update}
          onSpawning={(spawning) => state.set({ spawning, spawnError: null })}
          onShown={state.setNpcKeys}
        />
        <span className="w-px h-4 mx-1 bg-zinc-800" />
        <ToolButton icon={ArrowUUpLeftIcon} title="undo (cmd-Z)" active={false} onClick={state.undo} />
        <ToolButton icon={ArrowUUpRightIcon} title="redo (shift-cmd-Z)" active={false} onClick={state.redo} />
        <span className="w-px h-4 mx-1 bg-zinc-800" />
        {layers.map((layer) => (
          <button
            key={layer}
            type="button"
            className={cn(
              "px-2 py-0.5 rounded border cursor-pointer",
              meta.show[layer] ? "border-zinc-500 text-zinc-200 bg-zinc-800" : "border-zinc-800 text-zinc-500",
            )}
            onClick={() => state.toggleLayer(layer)}
          >
            {layer}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 flex">
        {meta.sidebarOpen && (
          <div className="relative shrink-0 flex" style={{ width: meta.sidebarWidth }}>
            <DecorSidebar
              key={w.mapKey} // remade per map: its arrangement is that map's
              w={w}
              selected={state.selected}
              onSelect={state.select}
              onRename={state.rename}
              onLocate={(key) => {
                const d = w.decor.runtime.byKey[key];
                if (d === undefined) return;
                const { x, y } = d.type === "point" ? d : d.center;
                map.current?.centreOn(x, y, locateZoom);
              }}
            />
          </div>
        )}
        {/* drag the list's edge to resize it — in past its narrowest to close it, and out again to open */}
        <div
          className="shrink-0 w-1.5 -ml-0.5 cursor-col-resize hover:bg-zinc-700/60 select-none"
          onMouseDown={state.onSidebarResizeStart}
        />
        <DecorMenu
          w={w}
          newDefOpts={{ img: state.img, tilt: state.tilt, y3d: state.y3d }}
          isBlocked={state.isMenuBlocked}
          onOpenChange={(menuOpen) => void (state.menuOpen = menuOpen)}
          onAdd={state.add}
          onTarget={(key) => state.selected.includes(key) || state.select([key])}
          onCommit={(def, merge) => state.commit([def], merge)}
          onRemove={(key) => state.remove([key])}
        >
          <NavMap2d
            key={w.mapKey} // remade per map: it reads where that map was left, and saves there
            apiRef={map}
            w={w}
            show={meta.show}
            npcKeys={meta.npcKeys}
            onNpcDrop={state.spawnNpc}
            cursor={state.tool === "select" && state.spawning === null ? undefined : "crosshair"}
            onClick={state.onMapClick}
            onMarquee={(rect, e) =>
              state.select(e.shiftKey ? [...new Set([...state.selected, ...keysWithin(w, rect)])] : keysWithin(w, rect))
            }
          >
            {manifestLore !== null && <ManifestLoreLayer w={w} entry={manifestLore} />}
            <DecorLayer
              w={w}
              selected={state.selected}
              showStatic={meta.show.static}
              onSelect={state.select}
              onCommit={state.commit}
              onPressing={state.onPressing}
            />
          </NavMap2d>
        </DecorMenu>
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
        props.active ? "border-zinc-400 text-zinc-100 bg-zinc-700" : "border-zinc-800 text-zinc-500 hover:bg-zinc-800",
      )}
      onClick={props.onClick}
    >
      <props.icon className="size-3.5" />
    </button>
  );
}

/**
 * The lore's characters and whoever else is in the World. A name arms a spawn, where the map is
 * next clicked; the eye beside it says whether they are drawn on the map
 */
function NpcsMenu(props: {
  npcKeys: string[];
  /** Those in the World: the rest are grey */
  spawned: string[];
  /** Those drawn on the map */
  shown: string[];
  spawning: null | string;
  onOpen(): void;
  onSpawning(npcKey: null | string): void;
  onShown(npcKeys: string[]): void;
}) {
  const { npcKeys, spawned, shown, spawning } = props;
  return (
    <Menu.Root onOpenChange={(open) => open && props.onOpen()}>
      <Menu.Trigger
        title={
          spawning === null
            ? "npcs: click one, then the map, to put them there — or drag them on the map"
            : `click the map to put ${spawning} there (Esc cancels)`
        }
        className={cn(
          // fixed, as each select in the bar is
          "flex items-center justify-between gap-1 w-16 px-1 py-0.5 rounded border border-zinc-800 bg-zinc-900",
          "outline-none cursor-pointer hover:bg-zinc-800",
          spawning !== null && "border-yellow-400 text-yellow-200",
        )}
      >
        npcs
        <CaretDownIcon className="size-3 shrink-0 text-zinc-500" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="z-50" sideOffset={4} align="start">
          {/* `decorator`: portalled out of the root, whose theme it must still take */}
          <Menu.Popup className="decorator bg-zinc-800 border border-zinc-700 rounded shadow-lg py-1 max-h-60 overflow-auto text-xs outline-none">
            {npcKeys.length === 0 && <div className="px-3 py-1 text-zinc-500">no npcs</div>}
            {npcKeys.map((npcKey) => {
              const isShown = shown.includes(npcKey);
              const EyeOrNot = isShown ? EyeIcon : EyeSlashIcon;
              return (
                <div key={npcKey} className="flex items-stretch">
                  <Menu.Item
                    className={cn(
                      "flex-1 px-3 py-1 cursor-pointer outline-none data-highlighted:bg-zinc-700",
                      spawned.includes(npcKey) ? "text-zinc-100" : "text-zinc-500",
                      spawning === npcKey && "text-yellow-200",
                    )}
                    onClick={() => props.onSpawning(spawning === npcKey ? null : npcKey)}
                  >
                    {npcKey}
                  </Menu.Item>
                  <Menu.Item
                    closeOnClick={false}
                    title={isShown ? "hide on the map" : "show on the map"}
                    className="grid place-items-center px-2 cursor-pointer outline-none data-highlighted:bg-zinc-700"
                    onClick={() => props.onShown(isShown ? shown.filter((x) => x !== npcKey) : [...shown, npcKey])}
                  >
                    <EyeOrNot className={cn("size-3.5", isShown ? "text-zinc-200" : "text-zinc-500")} />
                  </Menu.Item>
                </div>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

type State = {
  selected: string[];
  history: DecorHistory;
  tool: "select" | DecorType;
  /** The npc who goes where the map is next clicked */
  spawning: null | string;
  spawnError: null | string;
  /** Spawns them there, or respawns them — as the lore has them, if it does */
  spawnNpc(npcKey: string, at: Geom.VectJson): Promise<void>;
  img: string | undefined;
  tilt: boolean;
  y3d: number | undefined;
  menuOpen: boolean;
  menuBlockedUntil: number;
  onPressing(pressing: boolean): void;
  isMenuBlocked(): boolean;
  select(keys: string[]): void;
  /** Each def replaces its decor, which the World persists; every edit is undoable */
  commit(defs: Geomorph.DecorDef[], merge?: string): void;
  remove(keys: string[]): void;
  rename(key: string, next: string): void;
  undo(): void;
  redo(): void;
  setSidebar(patch: Partial<Pick<DecoratorUiMeta, "sidebarWidth" | "sidebarOpen">>): void;
  onSidebarResizeStart(e: React.MouseEvent): void;
  onMapClick(at: Geom.VectJson): void;
  add(type: DecorType, at: Geom.VectJson): void;
  /** The selection's height, else the tools' */
  setHeight(y3d: number | undefined, stepped?: boolean): void;
  selectedWithHeight(): HeightDef[];
  heightShown(): boolean;
  heightValue(): number | undefined;
  onKeyDown(e: React.KeyboardEvent): void;
  setNpcKeys(npcKeys: string[]): void;
  toggleLayer(layer: NavMapLayer): void;
};

const layers: NavMapLayer[] = ["nav", "labels", "obstacles", "grid", "static"];
const tools: ("select" | DecorType)[] = ["select", "point", "rect", "circle", "quad"];
type HeightDef = Extract<Geomorph.DecorDef, { type: "point" | "quad" }>;
const toolByKey: Record<string, "select" | DecorType> = { v: "select", p: "point", r: "rect", c: "circle", q: "quad" };
const minSidebarWidth = 120;
/** Ms after a press ends that no context menu opens */
const menuAfterUpMs = 100;

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

/** Its popup is portalled out of the panel, so it is told whose theme to take */
function Picker<T extends string>(props: Omit<Parameters<typeof BasePicker<T>>[0], "popupClassName">) {
  return <BasePicker {...props} popupClassName="decorator" />;
}
