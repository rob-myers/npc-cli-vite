import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, tw, useStateRef } from "@npc-cli/util";
import { useContext, useEffect, useLayoutEffect } from "react";
import { SkipNetContext, type State } from "./context";
import { Desktop } from "./desktop/Desktop";
import { Stack } from "./desktop/Stack";
import { Toolbar } from "./desktop/Toolbar";
import {
  centredIn,
  frontOf,
  newWindow,
  restack,
  stackOrdered,
  stackPx,
  toggleShade,
  withLayout,
} from "./desktop/windows";
import type { SkipNetUiMeta } from "./schema";
import { useSkipNetItems } from "./use-skip-net-items";

/** The intranet holding SCPs, as a classic desktop aligned with one World. See `docs/skip-net.md` */
export default function SkipNet({ meta }: { meta: SkipNetUiMeta }) {
  const { uiStoreApi } = useContext(UiContext);

  const state = useStateRef(
    (): State => ({
      clearAsked: false,
      distractionFree: false,
      hovered: false,
      items: [],
      meta,
      narrow: false,
      pressedFrontId: undefined,
      rootEl: null,
      showAll: false,

      bringToFront(id) {
        const { windows } = state.meta;
        state.pressedFrontId = frontOf(windows)?.id;
        if (state.pressedFrontId !== id) state.setWindows(restack(windows, id));
      },
      clear() {
        state.set({ clearAsked: false });
        state.setWindows([]);
      },
      close(id) {
        state.setWindows(state.meta.windows.filter((x) => x.id !== id));
      },
      moveInStack(id, by, flexById = {}) {
        const ordered = stackOrdered(state.meta.windows);
        const i = ordered.findIndex((x) => x.id === id);
        const j = i + by;
        if (i === -1 || j < 0 || j >= ordered.length) return;
        [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
        const orderOf = new Map(ordered.map((x, k) => [x.id, k]));
        state.setWindows(
          state.meta.windows.map((x) => ({
            ...x,
            stackOrder: orderOf.get(x.id),
            stackFlex: flexById[x.id] ?? x.stackFlex,
          })),
        );
      },
      open(content, { fresh = false, below, centre = false } = {}) {
        const { windows } = state.meta;
        const shown = windows.find(
          (x) => x.kind === content.kind && x.articleKey === content.articleKey && x.itemKey === content.itemKey,
        );
        if (shown !== undefined && !fresh) return state.bringToFront(shown.id);
        const win = newWindow(windows, content);
        const desk = centre && !state.narrow && state.rootEl?.querySelector<HTMLElement>("[data-skip-net-desk]");
        if (desk) Object.assign(win, centredIn(win, desk));
        // stacked, an even share of the height, as `stackFlex` may be saved in px
        const shares = windows.filter((x) => x.shadedH === undefined).map((x) => x.stackFlex ?? x.h);
        if (shares.length > 0) win.stackFlex = shares.reduce((sum, x) => sum + x, 0) / shares.length;
        const ordered = stackOrdered(windows);
        const at = ordered.findIndex((x) => x.id === below);
        if (at === -1) return state.setWindows([...windows, win]);
        // just beneath `below`, every window numbered afresh
        ordered.splice(at + 1, 0, win);
        const orderOf = new Map(ordered.map((x, k) => [x.id, k]));
        state.setWindows([...windows, win].map((x) => ({ ...x, stackOrder: orderOf.get(x.id) })));
      },
      saveLayout(layout) {
        state.setWindows(withLayout(state.meta.windows, layout));
      },
      setClearAsked(clearAsked) {
        state.set({ clearAsked });
      },
      setStackFlex(flexById, unfoldId) {
        state.setWindows(
          state.meta.windows.map((x) => {
            const y = x.id === unfoldId ? toggleShade(x) : x;
            return y.id in flexById ? { ...y, stackFlex: flexById[y.id] } : y;
          }),
        );
      },
      setWindow(id, patch) {
        state.setWindows(state.meta.windows.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      },
      setWindows(windows) {
        uiStoreApi.setUiMeta(state.meta.id, (draft) => void ((draft as SkipNetUiMeta).windows = windows));
        if (windows.length === 0) state.toggleShowAll(false); // nothing left to show
      },
      toggleShade(id) {
        state.setWindows(state.meta.windows.map((x) => (x.id === id ? toggleShade(x) : x)));
      },
      toggleDistractionFree(on = !state.distractionFree) {
        if (on !== state.distractionFree) state.set({ distractionFree: on });
      },
      toggleShowAll(on = !state.showAll) {
        if (on !== state.showAll) state.set({ showAll: on });
      },
    }),
  );

  state.meta = meta; // its handlers run long after this render
  state.items = useSkipNetItems(meta.worldKey);

  /** Measured before the first paint too, so a narrow panel never shows the desktop first */
  useLayoutEffect(() => {
    if (state.rootEl === null) return;
    const sync = (width: number) => {
      const narrow = width < stackPx;
      if (narrow !== state.narrow) state.set({ narrow });
    };
    sync(state.rootEl.clientWidth);
    const observer = new ResizeObserver(([entry]) => sync(entry.contentRect.width));
    observer.observe(state.rootEl);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (meta.opening === undefined) return;
    const { distractionFree, ...content } = meta.opening;
    state.open(content, { centre: true });
    if (distractionFree === true) state.toggleDistractionFree(true);
    uiStoreApi.setUiMeta(meta.id, (draft) => void delete (draft as SkipNetUiMeta).opening);
  }, [meta.opening]);

  useEffect(() => {
    /** A backtick over SkipNet toggles Show All, unless typing */
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state.hovered && state.distractionFree) return state.toggleDistractionFree(false);
      if (e.key !== "`" || !state.hovered || state.narrow || state.meta.windows.length === 0) return;
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]") !== null) return;
      e.preventDefault();
      state.toggleShowAll();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <SkipNetContext.Provider value={state}>
      <div
        ref={(el) => void (state.rootEl = el)}
        onPointerEnter={() => void (state.hovered = true)}
        onPointerLeave={() => void (state.hovered = false)}
        className={cn(
          "relative size-full flex flex-col bg-mac-desk text-mac-text text-xs tracking-wide [--color-spinner:var(--color-mac-muted)]",
          state.distractionFree && distractionFreeClass,
        )}
      >
        <Toolbar />
        {state.narrow ? <Stack /> : <Desktop />}
      </div>
    </SkipNetContext.Provider>
  );
}

/** The front window's shadow dims all else, which SkipNet clips */
const distractionFreeClass = tw(
  "[&_[data-front]]:relative [&_[data-front]]:z-10 [&_[data-front]]:shadow-[0_0_0_200vmax_rgb(0_0_0/0.55)]",
);
