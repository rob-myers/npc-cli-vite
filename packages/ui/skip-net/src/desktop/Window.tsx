import { cn, tw } from "@npc-cli/util";
import { CaretDownIcon, CaretUpIcon, XIcon } from "@phosphor-icons/react";
import { useContext, useEffect, useState } from "react";
import { ArticlePane } from "../article/ArticlePane";
import { SkipNetContext } from "../context";
import { ItemPane } from "../ItemPane";
import { LibraryPane } from "../library/LibraryPane";
import type { SkipNetWindow } from "../schema";
import { FolderWindow } from "./FolderWindow";

/**
 * A window's frame: a title bar to drag it by, with close and windowshade boxes whilst in front.
 * Stacked, every bar has both boxes, and a tap on it folds or unfolds it.
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
  const boxes = front || stacked;

  return (
    <div className="size-full flex flex-col bg-mac-window text-mac-text border border-mac-edge shadow-[1px_1px_0_var(--color-mac-shadow)]">
      <header
        className={cn(
          "relative shrink-0 h-4.5 flex items-center justify-between gap-2 px-1.5 bg-mac-title select-none touch-none",
          stacked ? "cursor-pointer" : "skip-net-drag cursor-grab active:cursor-grabbing",
          !shaded && "border-b border-mac-edge",
        )}
        onClick={
          stacked ? (e) => (e.target as HTMLElement).closest("button") === null && state.toggleShade(win.id) : undefined
        }
      >
        {front && <span className="absolute inset-x-1 inset-y-0.75" style={stripesStyle} />}
        <CloseBox hidden={!boxes} onClose={() => state.close(win.id)} />
        <span className={cn("relative min-w-0 px-2 truncate bg-mac-title", front ? "font-bold" : "text-mac-muted")}>
          {title}
        </span>
        {stack && (
          <span className="relative ml-auto flex gap-1">
            {moveBoxes
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
        )}
        <button
          type="button"
          title={shaded ? "roll down" : "roll up"}
          className={cn(boxClass, "flex flex-col justify-center", !boxes && "invisible")}
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
          <WindowBody win={win} />
        </div>
      )}
    </div>
  );
}

/** Its first press arms it red, a second within `confirmMs` closes the window */
function CloseBox({ hidden, onClose }: { hidden: boolean; onClose(): void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timeoutId = window.setTimeout(() => setArmed(false), confirmMs);
    return () => window.clearTimeout(timeoutId);
  }, [armed]);
  return (
    <button
      type="button"
      title={armed ? "press again to close" : "close"}
      className={cn(
        boxClass,
        "grid place-items-center text-mac-text",
        armed && "bg-red-600 border-red-700 dark:border-red-400 text-white",
        hidden && "invisible",
      )}
      onClick={() => (armed ? onClose() : setArmed(true))}
      onBlur={() => setArmed(false)}
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
    case "library":
      return <LibraryPane win={win} />;
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

const boxClass = tw(
  "skip-net-no-drag relative size-2.75 shrink-0 border border-mac-edge dark:border-mac-text bg-mac-title cursor-pointer active:bg-mac-select",
);
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
