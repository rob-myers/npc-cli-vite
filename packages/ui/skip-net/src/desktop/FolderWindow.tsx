import { useContext } from "react";
import { articleKeys } from "../articles";
import { SkipNetContext } from "../context";
import { infoBarClass } from "./classes";
import { DeskIcon, DocumentIcon } from "./icons";

/** The npc folder: an icon per article, opened by a double-click */
export function FolderWindow() {
  const state = useContext(SkipNetContext);
  return (
    <div className="size-full flex flex-col">
      <div className={infoBarClass}>{articleKeys.length} items</div>
      <div className="flex-1 min-h-0 overflow-auto scrollbar-thin p-3 grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] content-start justify-items-center gap-y-3">
        {articleKeys.map((articleKey) => (
          <DeskIcon key={articleKey} label={articleKey} onOpen={() => state.open({ kind: "article", articleKey })}>
            <DocumentIcon />
          </DeskIcon>
        ))}
      </div>
    </div>
  );
}
