import { cn, tw, useStateRef } from "@npc-cli/util";
import { CaretDownIcon, CaretUpIcon, XIcon } from "@phosphor-icons/react";
import { useContext, useEffect } from "react";
import { ArticlePane } from "../article/ArticlePane";
import { SkipNetContext, TitleSlotContext } from "../context";
import { ItemPane } from "../ItemPane";
import type { SkipNetWindow } from "../schema";
import { FolderWindow } from "./FolderWindow";

/**
 * A window's frame: a title bar to drag it by, with close and windowshade boxes.
 * A click on its bar, not a drag, folds or unfolds it, once in front.
 */
export function Window(props: {
  front: boolean;
  /** Whilst stacked, whether it is first or last, so it cannot move past */
  stack?: { first: boolean; last: boolean };
  win: SkipNetWindow;
}) {
  const { front, stack, win } = props;
  const stacked = stack !== undefined;
  const state = useContext(SkipNetContext);
  const shaded = win.shadedH !== undefined;
  const title = titleOf(win, state.items);
  const frame = useStateRef(
    (): FrameState => ({
      downAt: { x: 0, y: 0 },
      titleSlot: null,

      setTitleSlot(el) {
        if (el !== frame.titleSlot) frame.set({ titleSlot: el });
      },
    }),
  );

  return (
    <div className="size-full flex flex-col bg-mac-window text-mac-text border border-mac-edge shadow-[1px_1px_0_var(--color-mac-shadow)]">
      <header
        className={cn(
          "relative shrink-0 h-4.5 flex items-center justify-between gap-2 px-1.5 bg-mac-title select-none touch-none",
          stacked ? "cursor-pointer" : "skip-net-drag cursor-grab active:cursor-grabbing",
          !shaded && "border-b border-mac-edge",
        )}
        onPointerDown={(e) => void (frame.downAt = { x: e.clientX, y: e.clientY })}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button") !== null) return;
          const { downAt } = frame;
          if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > clickSlopPx) return;
          if (!stacked && state.pressedFrontId !== win.id) return; // a click on a window behind only fronts it
          state.toggleShade(win.id);
        }}
      >
        {front && <span className="absolute inset-x-1 inset-y-0.75" style={stripesStyle} />}
        <CloseBox onClose={() => state.close(win.id)} />
        <span className={cn("relative min-w-0 px-2 truncate bg-mac-title", front ? "font-bold" : "text-mac-muted")}>
          {title}
        </span>
        <span className="relative ml-auto min-w-0 flex items-center gap-1">
          <span ref={frame.setTitleSlot} className="skip-net-no-drag min-w-0 flex items-center gap-1 bg-mac-title" />
          {stack &&
            moveBoxes
              .filter(({ by }) => !(by === -1 ? stack.first : stack.last))
              .map(({ by, Icon, title }) => (
                <button
                  key={by}
                  type="button"
                  title={title}
                  className={moveBoxClass}
                  onClick={() => state.moveInStack(win.id, by)}
                >
                  <Icon weight="fill" className="size-2.5" />
                </button>
              ))}
        </span>
        <button
          type="button"
          title={shaded ? "roll down" : "roll up"}
          className={cn(boxClass, "flex flex-col justify-center")}
          onClick={() => state.toggleShade(win.id)}
        >
          <span className="h-px mx-px bg-mac-edge dark:bg-mac-text" />
        </button>
      </header>
      {!shaded && (
        <div
          className={cn(
            "flex-1 min-h-0 overflow-hidden",
            stacked && "transition-opacity duration-150 starting:opacity-0",
          )}
        >
          <TitleSlotContext.Provider value={frame.titleSlot}>
            <WindowBody win={win} />
          </TitleSlotContext.Provider>
        </div>
      )}
    </div>
  );
}

/** Its first press arms it red, a second within `confirmMs` closes the window */
function CloseBox({ onClose }: { onClose(): void }) {
  const box = useStateRef(
    (): CloseBoxState => ({
      armed: false,
      timeoutId: 0,

      arm() {
        window.clearTimeout(box.timeoutId);
        box.timeoutId = window.setTimeout(box.disarm, confirmMs);
        box.set({ armed: true });
      },
      disarm() {
        window.clearTimeout(box.timeoutId);
        if (box.armed) box.set({ armed: false });
      },
    }),
  );
  useEffect(() => () => window.clearTimeout(box.timeoutId), []);
  const { armed } = box;
  return (
    <button
      type="button"
      title={armed ? "press again to close" : "close"}
      className={cn(
        boxClass,
        "grid place-items-center text-mac-text",
        armed && "bg-red-600 border-red-700 dark:border-red-400 text-white",
      )}
      onClick={() => (armed ? onClose() : box.arm())}
      onBlur={box.disarm}
    >
      <XIcon weight="bold" className="size-2" />
    </button>
  );
}

function WindowBody({ win }: { win: SkipNetWindow }) {
  const state = useContext(SkipNetContext);
  switch (win.kind) {
    case "folder":
      return <FolderWindow />;
    case "article":
      return <ArticlePane win={win} />;
    case "item":
      return (
        <ItemPane
          item={state.items.find((x) => x.key === win.itemKey)}
          itemKey={win.itemKey}
          worldKey={state.meta.worldKey}
        />
      );
  }
}

function titleOf(win: SkipNetWindow, items: JshCli.SkipNetItem[]): string {
  switch (win.kind) {
    case "folder":
      return "npc";
    case "article":
      return win.articleKey ?? "article";
    case "item":
      return items.find((x) => x.key === win.itemKey)?.title ?? win.itemKey ?? "item";
    default:
      return win.kind;
  }
}

type FrameState = {
  /** Where a press on the bar began, so a drag's release is not a click */
  downAt: { x: number; y: number };
  /** Where its body shows things in its title bar (`InTitle`) */
  titleSlot: null | HTMLElement;
  setTitleSlot(el: null | HTMLElement): void;
};

type CloseBoxState = {
  /** A first press arms it, so a second closes the window */
  armed: boolean;
  timeoutId: number;
  arm(): void;
  disarm(): void;
};

const boxClass = tw(
  "skip-net-no-drag relative size-2.75 shrink-0 border border-mac-edge dark:border-mac-text bg-mac-title cursor-pointer active:bg-mac-select",
);
/** How far a press on a bar may move and still be a click */
const clickSlopPx = 4;
/** How long a close box stays armed */
const confirmMs = 2500;
/** The front window's title bar is pinstriped */
const stripesStyle = {
  backgroundImage: "repeating-linear-gradient(to bottom, var(--color-mac-stripe) 0 1px, transparent 1px 2px)",
};
/** A stacked bar's up or down box, wider than tall for a finger */
const moveBoxClass = tw(
  "skip-net-no-drag grid place-items-center h-3.5 w-5 border border-mac-edge bg-mac-title cursor-pointer dark:border-mac-text active:bg-mac-select active:text-mac-on-select",
);
const moveBoxes = [
  { by: -1, Icon: CaretUpIcon, title: "move up" },
  { by: 1, Icon: CaretDownIcon, title: "move down" },
] as const;
