import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Menu } from "@base-ui/react/menu";
import { Menubar } from "@base-ui/react/menubar";
import { cn, tw } from "@npc-cli/util";
import { type ReactNode, useContext } from "react";
import { SkipNetContext } from "../context";
import { frontOf } from "./windows";

/** SkipNet's menu bar, its menus portalled into SkipNet */
export function MenuBar() {
  const state = useContext(SkipNetContext);
  const { arrange, windows, worldKey } = state.meta;
  const front = frontOf(windows);

  return (
    <>
      <Menubar className="shrink-0 relative z-2 flex items-stretch h-5 px-1 bg-mac-window text-mac-text border-b border-mac-edge select-none">
        <BarMenu label="◆">
          <Menu.Item className={itemClass} disabled>
            SkipNet · {worldKey}
          </Menu.Item>
        </BarMenu>
        <BarMenu label="File">
          <Menu.Item className={itemClass} onClick={() => state.open({ kind: "folder" })}>
            Open npc Folder
          </Menu.Item>
          {state.items.map((item) => (
            <Menu.Item
              key={item.key}
              className={itemClass}
              onClick={() => state.open({ kind: "item", itemKey: item.key })}
            >
              Open {item.title}
            </Menu.Item>
          ))}
          <Menu.Separator className={separatorClass} />
          <Menu.Item
            className={itemClass}
            disabled={front === undefined}
            onClick={() => front !== undefined && state.close(front.id)}
          >
            Close Window
          </Menu.Item>
        </BarMenu>
        <BarMenu label="View">
          <Menu.Item className={itemClass} disabled={state.narrow} onClick={state.cleanUp}>
            Clean Up
          </Menu.Item>
          <Menu.Separator className={separatorClass} />
          {arranges.map(({ value, label }) => (
            <Menu.Item
              key={value}
              className={itemClass}
              disabled={state.narrow}
              onClick={() => state.setArrange(value)}
            >
              <span className="w-3">{arrange === value ? "✓" : ""}</span>
              {label}
            </Menu.Item>
          ))}
        </BarMenu>
        <BarMenu label="Special">
          <Menu.Item className={itemClass} disabled={windows.length === 0} onClick={() => state.setClearAsked(true)}>
            Clear Desktop…
          </Menu.Item>
        </BarMenu>
      </Menubar>
      <ClearAlert />
    </>
  );
}

function BarMenu({ children, label }: { children: ReactNode; label: string }) {
  const state = useContext(SkipNetContext);
  return (
    <Menu.Root>
      <Menu.Trigger className="px-2 font-bold cursor-default outline-none data-popup-open:bg-mac-select data-popup-open:text-mac-on-select">
        {label}
      </Menu.Trigger>
      <Menu.Portal container={state.rootEl}>
        <Menu.Positioner className="z-3000" positionMethod="absolute" align="start" sideOffset={0}>
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

const arranges = [
  { value: "free", label: "Free" },
  { value: "tidy", label: "Tidy" },
] as const;

const itemClass = tw(
  "flex items-center gap-1 px-3 py-0.5 cursor-default outline-none data-highlighted:bg-mac-select data-highlighted:text-mac-on-select data-disabled:text-mac-muted",
);
const separatorClass = tw("my-0.5 border-t border-dotted border-mac-muted");
const alertButtonClass = tw(
  "min-w-16 px-3 py-0.5 rounded-full border border-mac-edge bg-mac-window cursor-pointer active:bg-mac-select active:text-mac-on-select",
);
