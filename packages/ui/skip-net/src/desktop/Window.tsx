import { cn, tw, useStateRef } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { Picker } from "@npc-cli/util/picker";
import { CaretDownIcon, CaretUpIcon, DotsSixVerticalIcon, MinusIcon, XIcon } from "@phosphor-icons/react";
import { useContext, useEffect } from "react";
import { ArticlePane } from "../article/ArticlePane";
import { articleKeys } from "../articles";
import { ChatWindow } from "../chat/ChatWindow";
import { SkipNetContext, TitleSlotContext } from "../context";
import { ItemPane } from "../ItemPane";
import type { SkipNetWindow } from "../schema";
import { titlePickerPopupClass } from "./classes";
import { FolderWindow } from "./FolderWindow";
import { titleOf } from "./windows";

/**
 * A window's frame: a title bar with close and windowshade boxes. On the desktop the bar drags it, stacked only its grip.
 * Stacked, a click on its bar folds it once in front, and unfolds a folded one. A click on one behind only fronts it.
 */
export function Window(props: {
  front: boolean;
  /** Whilst stacked, whether it is first or last, so it cannot move past */
  stack?: { first: boolean; last: boolean };
  win: SkipNetWindow;
}) {
  const { front, stack, win } = props;
  const stacked = stack !== undefined;
  /** Stacked on touch, its bar and boxes are finger-sized */
  const big = stacked && touchDevice;
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
    <div
      className={cn(
        // folded on the desktop its bar overflows its row into the gap below
        shaded && !stacked ? "w-full" : "size-full",
        "flex flex-col bg-mac-window text-mac-text border border-mac-edge shadow-[1px_1px_0_var(--color-mac-shadow)]",
      )}
    >
      <header
        className={cn(
          "relative shrink-0 flex items-center justify-between gap-2 px-1.5 bg-mac-title select-none touch-none",
          big && "text-sm",
          big ? "h-11" : "h-6",
          stacked
            ? "cursor-pointer data-dragging:bg-mac-select/10"
            : "skip-net-drag cursor-grab active:cursor-grabbing",
          !shaded && "border-b border-mac-edge",
        )}
        onPointerDown={(e) => void (frame.downAt = { x: e.clientX, y: e.clientY })}
        onClick={(e) => {
          if (!stacked) return;
          // a portalled popup's clicks bubble here through React
          if (!e.currentTarget.contains(e.target as Node)) return;
          if ((e.target as HTMLElement).closest("button, [data-stack-grip]") !== null) return;
          const { downAt } = frame;
          if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > clickSlopPx) return;
          if (state.pressedFrontId !== win.id && !shaded) return; // a click on an open window behind only fronts it
          state.toggleShade(win.id);
        }}
      >
        {front && (
          // fainter stacked, where the grips' dots sit on them
          <span className={cn("absolute inset-x-1 inset-y-0.75", stacked && "opacity-40")} style={stripesStyle} />
        )}
        {stacked && (
          <span data-stack-grip title="drag to resize" className={cn(gripClass, "shrink-0 -mx-1", big ? "w-7" : "w-4")}>
            <DotsSixVerticalIcon weight="bold" className={big ? "size-4" : "size-3"} />
          </span>
        )}
        <span
          className={cn(
            // the session picker beside it gives way first
            "relative min-w-0 px-2 bg-mac-title",
            win.kind === "article" ? "flex items-center gap-1" : "truncate",
            front ? "font-bold" : "text-mac-muted",
            big ? "text-base" : "text-sm",
          )}
        >
          {win.kind === "article" ? (
            <>
              <span className="truncate">{title}</span>
              <Picker
                chevronOnly
                value={title}
                options={articleKeys}
                onChange={(articleKey) => state.setWindow(win.id, { articleKey, fit: true })}
                title="change article"
                className={articlePickerClass}
                popupClassName={titlePickerPopupClass}
              />
            </>
          ) : (
            title
          )}
        </span>
        {big && (
          // a second grip, filling the bar between the title and the picker, easier to find with a thumb
          <span data-stack-grip title="drag to resize" className={cn(gripClass, "flex-1 min-w-0")}>
            <span className="h-3 w-full px-2 bg-clip-content opacity-40" style={longGripStyle} />
          </span>
        )}
        <span className={cn("relative min-w-0 shrink-[10] flex items-center gap-1", !big && "ml-auto")}>
          <span ref={frame.setTitleSlot} className="min-w-0 flex items-center gap-1 bg-mac-title" />
          {stack &&
            moveBoxes
              .filter(({ by }) => !(by === -1 ? stack.first : stack.last))
              .map(({ by, Icon, title }) => (
                <button
                  key={by}
                  type="button"
                  title={title}
                  className={cn(moveBoxClass, big && bigMoveBoxClass)}
                  onClick={() => state.moveInStack(win.id, by)}
                >
                  <Icon weight="fill" className={big ? "size-3" : "size-2.5"} />
                </button>
              ))}
        </span>
        {/* Show All closes it by a badge of its own instead */}
        {!(state.showAll && !stacked) && (
          <>
            <button
              type="button"
              title={shaded ? "roll down" : "roll up"}
              className={cn(boxClass, big && bigBoxClass)}
              onClick={() => state.toggleShade(win.id)}
            >
              <MinusIcon weight="bold" className={boxIconClass(big)} />
            </button>
            <CloseBox big={big} onClose={() => state.close(win.id)} />
          </>
        )}
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
function CloseBox({ big, onClose }: { big: boolean; onClose(): void }) {
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
      className={cn(boxClass, big && bigBoxClass, armed && "bg-red-600 border-red-700 dark:border-red-400 text-white")}
      onClick={() => (armed ? onClose() : box.arm())}
      onBlur={box.disarm}
    >
      <XIcon weight="bold" className={boxIconClass(big)} />
    </button>
  );
}

function WindowBody({ win }: { win: SkipNetWindow }) {
  const state = useContext(SkipNetContext);
  switch (win.kind) {
    case "folder":
      return <FolderWindow win={win} />;
    case "chat":
      return <ChatWindow win={win} />;
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
  "skip-net-no-drag relative grid place-items-center size-4 shrink-0 border border-mac-edge dark:border-mac-text bg-mac-title text-mac-text cursor-pointer active:bg-mac-select",
);
/** A raised box on a touch-sized bar: lit above and left, shaded below and right, with a faint edge */
const embossClass = tw(
  "rounded-sm border-mac-edge/40 dark:border-mac-text/15 shadow-[inset_1px_1px_0_rgb(255_255_255/0.12),inset_-1px_-1px_0_rgb(0_0_0/0.35)]",
);
const bigBoxClass = cn(embossClass, "size-6");
const bigMoveBoxClass = cn(embossClass, "h-6 w-8");
/** The chevron beside an article's title, which alone picks another */
const articlePickerClass = tw(
  "skip-net-no-drag h-5 px-1.5 py-0 rounded-sm border-0 bg-transparent text-current font-[inherit] text-[length:inherit] leading-none [&_svg]:text-current hover:bg-mac-select/15 data-popup-open:bg-mac-select/15",
);
/** A stacked bar's grip, which alone drags it */
const gripClass = tw("relative grid place-items-center h-full cursor-row-resize text-mac-muted");
/** The x or minus in a box */
const boxIconClass = (big: boolean) => (big ? "size-3" : "size-2.5");
/** How far a press on a bar may move and still be a click */
const clickSlopPx = 4;
/** How long a close box stays armed */
const confirmMs = 2500;
/** Two rows of dots along the middle grip, in its colour */
const longGripStyle = {
  backgroundImage: "radial-gradient(currentColor 1.25px, transparent 1.75px)",
  backgroundSize: "6px 6px",
  backgroundPosition: "center",
};
/** The front window's title bar is pinstriped */
const stripesStyle = {
  backgroundImage: "repeating-linear-gradient(to bottom, var(--color-mac-stripe) 0 1px, transparent 1px 2px)",
};
/** A stacked bar's up or down box, wider than tall for a finger */
const moveBoxClass = tw(
  "skip-net-no-drag grid place-items-center h-4 w-6 border border-mac-edge bg-mac-title cursor-pointer dark:border-mac-text active:bg-mac-select active:text-mac-on-select",
);
const moveBoxes = [
  { by: -1, Icon: CaretUpIcon, title: "move up" },
  { by: 1, Icon: CaretDownIcon, title: "move down" },
] as const;

const touchDevice = isTouchDevice();
