import { useContext } from "react";
import { SkipNetContext } from "../context";
import { ChatIcon, DeskIcon, FolderIcon, ItemIcon } from "./icons";

/** A column at the top-right of what is in view, under every window. Else a row, e.g. on an empty stack */
export function DesktopIcons({ layout = "column" }: { layout?: "column" | "row" }) {
  const state = useContext(SkipNetContext);
  const icons = (
    <>
      <DeskIcon label="files" onOpen={() => state.open({ kind: "folder" })}>
        <FolderIcon />
      </DeskIcon>
      <DeskIcon label="chat" onOpen={() => state.open({ kind: "chat" })}>
        <ChatIcon />
      </DeskIcon>
      {state.items.map((item) => (
        <DeskIcon key={item.key} label={item.title} onOpen={() => state.open({ kind: "item", itemKey: item.key })}>
          <ItemIcon />
        </DeskIcon>
      ))}
    </>
  );
  if (layout === "row") {
    return <div className="flex flex-wrap gap-3 p-3">{icons}</div>;
  }
  return (
    <div className="sticky top-0 left-0 z-1 h-0 w-full flex justify-end pointer-events-none">
      <div className="pt-3 pr-3 flex flex-col items-center gap-3 pointer-events-auto">{icons}</div>
    </div>
  );
}
