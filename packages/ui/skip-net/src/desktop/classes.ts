import { tw } from "@npc-cli/util";

/** A 2px dither that scrolls with the desktop */
export const deskStyle = {
  backgroundColor: "var(--color-mac-desk)",
  backgroundImage: "repeating-conic-gradient(var(--color-mac-desk-dot) 0 25%, transparent 0 50%)",
  backgroundSize: "4px 4px",
  backgroundAttachment: "local",
};

/** A small picker in a title bar, in the desktop's greys over `Picker`'s own. Hovered, it is faintly tinted */
export const titlePickerClass = tw(
  "skip-net-no-drag h-3.5 py-0 rounded-none border-0 bg-mac-title text-mac-text text-[11px] leading-none [&_svg]:text-current hover:bg-mac-select/15 data-popup-open:bg-mac-select/15",
);

/** A title bar picker's popup, in the desktop's greys over `Picker`'s own, its scrollbar thin and faint */
export const titlePickerPopupClass = tw(
  "scrollbar-thin [--color-scrollbar:rgb(128_128_128/0.25)] rounded-none! border-mac-edge! bg-mac-window! text-mac-text! [&_[data-selected]]:text-mac-text! [&_[data-selected]]:font-bold [&_[data-highlighted]]:bg-mac-select/15!",
);
