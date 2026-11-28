import { Popover } from "@base-ui/react/popover";
import { tw } from "@npc-cli/util";
import { InfoIcon } from "@phosphor-icons/react";
import { type ReactNode, useContext } from "react";
import { SkipNetContext } from "../context";

/** An info icon raised as a superscript in the text, showing its note on hover or press, e.g. `<SideNote>Only the player.</SideNote>` */
export function SideNote({ children }: { children: ReactNode }) {
  const state = useContext(SkipNetContext);
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={100}
        aria-label="side note"
        className="inline-grid place-items-center align-baseline -translate-y-[0.25em] ml-0.5 text-mac-muted hover:text-mac-text data-popup-open:text-mac-text cursor-pointer"
      >
        <InfoIcon weight="bold" className="size-3" />
      </Popover.Trigger>
      <Popover.Portal container={state.rootEl}>
        <Popover.Positioner
          className="z-3000"
          positionMethod="absolute"
          side="right"
          sideOffset={4}
          collisionPadding={8}
        >
          <Popover.Popup className={popupClass}>{children}</Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The title bar's shade, set apart from the window. Its code as the article's, which it is portalled out of */
const popupClass = tw(
  "max-w-60 px-3 py-2 bg-mac-title text-mac-text rounded-md leading-snug border border-mac-edge shadow-[1px_1px_0_var(--color-mac-shadow)] font-sans outline-none text-[0.9rem] [&_code]:px-1 [&_code]:rounded-sm [&_code]:bg-mac-text/10 [&_code]:font-mono [&_code]:text-[0.85em]",
);
