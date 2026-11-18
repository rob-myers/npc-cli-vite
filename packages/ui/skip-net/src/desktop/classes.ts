import { tw } from "@npc-cli/util";

/** A 2px dither that scrolls with the desktop */
export const deskStyle = {
  backgroundColor: "var(--color-mac-desk)",
  backgroundImage: "repeating-conic-gradient(var(--color-mac-desk-dot) 0 25%, transparent 0 50%)",
  backgroundSize: "4px 4px",
  backgroundAttachment: "local",
};

/** A title bar picker's popup, in the desktop's greys over `Picker`'s own */
export const titlePickerPopupClass = tw(
  "rounded-none! border-mac-edge! bg-mac-window! text-mac-text! [&_[data-selected]]:text-mac-text! [&_[data-selected]]:font-bold [&_[data-highlighted]]:bg-mac-select/15!",
);
