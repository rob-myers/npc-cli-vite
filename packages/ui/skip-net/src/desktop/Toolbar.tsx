import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Menu } from "@base-ui/react/menu";
import { Menubar } from "@base-ui/react/menubar";
import { cn, Tip, tw } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { FlashlightIcon, SquaresFourIcon, TrashIcon } from "@phosphor-icons/react";
import { type ReactNode, useContext } from "react";
import { SkipNetContext } from "../context";

/** SkipNet's toolbar: Show All, distraction-free, Clear, and the ◆ menu, portalled into SkipNet */
export function Toolbar() {
  const state = useContext(SkipNetContext);
  const { windows, worldKey } = state.meta;

  return (
    <>
      <Menubar className={cn(toolbarClass, state.narrow ? stackedClass : "top-1 right-1")}>
        {!state.narrow && (
          <Tip content="show all windows (`), Escape ends it" side="bottom">
            <button
              type="button"
              className={cn(barButtonClass, state.showAll && "bg-mac-select text-mac-on-select")}
              disabled={windows.length === 0}
              onClick={() => state.toggleShowAll()}
            >
              <SquaresFourIcon weight="bold" className="size-4" />
            </button>
          </Tip>
        )}
        <Tip
          content="distraction-free: dims all but the front window. Escape, or a press on the desk, ends it"
          side="bottom"
        >
          <button
            type="button"
            className={cn(barButtonClass, state.distractionFree && "bg-mac-select text-mac-on-select")}
            disabled={windows.length === 0}
            onClick={() => state.toggleDistractionFree()}
          >
            <FlashlightIcon weight="bold" className="size-4" />
          </button>
        </Tip>
        {/* asks first, in a classic alert box */}
        <Tip content="clear the desktop" side="bottom">
          <button
            type="button"
            className={barButtonClass}
            disabled={windows.length === 0}
            onClick={() => state.setClearAsked(true)}
          >
            <TrashIcon weight="bold" className="size-4" />
          </button>
        </Tip>
        <BarMenu label="◆" side={state.narrow ? "top" : "bottom"}>
          <Menu.Item className={itemClass} disabled>
            SkipNet · {worldKey}
          </Menu.Item>
        </BarMenu>
      </Menubar>
      <ClearAlert />
    </>
  );
}

function BarMenu({ children, label, side }: { children: ReactNode; label: string; side: "top" | "bottom" }) {
  const state = useContext(SkipNetContext);
  return (
    <Menu.Root>
      <Menu.Trigger className="px-2.5 text-sm font-bold cursor-default outline-none data-popup-open:bg-mac-select data-popup-open:text-mac-on-select">
        {label}
      </Menu.Trigger>
      <Menu.Portal container={state.rootEl}>
        <Menu.Positioner className="z-3000" positionMethod="absolute" side={side} align="end" sideOffset={2}>
          <Menu.Popup className="min-w-40 py-0.5 bg-mac-window text-mac-text text-xs border border-mac-edge shadow-[1px_1px_0_var(--color-mac-shadow)] outline-none">
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** A classic alert box, asking before every window closes */
function ClearAlert() {
  const state = useContext(SkipNetContext);
  return (
    <AlertDialog.Root open={state.clearAsked} onOpenChange={(open) => state.setClearAsked(open)}>
      <AlertDialog.Portal container={state.rootEl}>
        <AlertDialog.Backdrop className="absolute inset-0 z-3000 bg-black/20" />
        <AlertDialog.Popup className="absolute z-3001 left-1/2 top-12 -translate-x-1/2 w-72 p-0.75 bg-mac-window text-mac-text text-xs border border-mac-edge shadow-[2px_2px_0_var(--color-mac-shadow)] outline-none">
          <div className="flex flex-col gap-3 p-3 border-2 border-mac-edge">
            <AlertDialog.Title className="font-bold">Clear the desktop?</AlertDialog.Title>
            <AlertDialog.Description>Every window closes. Their sessions keep running.</AlertDialog.Description>
            <div className="flex justify-end gap-3">
              <AlertDialog.Close className={alertButtonClass}>Cancel</AlertDialog.Close>
              <button
                type="button"
                className={cn(alertButtonClass, "outline-2 outline-offset-1 outline-mac-edge")}
                onClick={state.clear}
              >
                Clear
              </button>
            </div>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** Floats over the desk's top-right, above every window. Stacked, in the last bar: see `stackedClass` */
const toolbarClass = tw(
  "absolute z-2000 flex items-stretch h-7 bg-mac-window text-mac-text border border-mac-edge shadow-[1px_1px_0_var(--color-mac-shadow)] select-none",
);
/** Stacked, centred in the last bar, often folded: clear of its title and close box. A mouse's bar is shorter */
const stackedClass = cn("left-1/2 -translate-x-1/2", isTouchDevice() ? "bottom-[9px]" : "bottom-px h-6");

/** A toolbar button: Show All, as macOS's Mission Control, or Clear */
const barButtonClass = tw(
  "px-2.5 grid place-items-center cursor-pointer outline-none disabled:text-mac-muted disabled:cursor-default",
);

const itemClass = tw(
  "flex items-center gap-1 px-3 py-0.5 cursor-default outline-none data-highlighted:bg-mac-select data-highlighted:text-mac-on-select data-disabled:text-mac-muted",
);
const alertButtonClass = tw(
  "min-w-16 px-3 py-0.5 rounded-full border border-mac-edge bg-mac-window cursor-pointer active:bg-mac-select active:text-mac-on-select",
);
