import { tw } from "@npc-cli/util";

/** A 2px dither that scrolls with the desktop */
export const deskStyle = {
  backgroundColor: "var(--color-mac-desk)",
  backgroundImage: "repeating-conic-gradient(var(--color-mac-desk-dot) 0 25%, transparent 0 50%)",
  backgroundSize: "4px 4px",
  backgroundAttachment: "local",
};

/** The strip under a window's title, e.g. "12 items", double-ruled below */
export const infoBarClass = tw(
  "shrink-0 flex items-center gap-2 min-h-5 px-2 py-0.5 border-b-[3px] border-double border-mac-edge bg-mac-window text-mac-text",
);
