import { type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";
import { TitleSlotContext } from "../context";

/** Its children, shown in its window's title bar */
export function InTitle({ children }: { children: ReactNode }) {
  const slot = useContext(TitleSlotContext);
  return slot === null ? null : createPortal(children, slot);
}
