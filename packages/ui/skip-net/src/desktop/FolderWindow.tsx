import statsByKey from "virtual:skip-net-articles";
import { cn, tw } from "@npc-cli/util";
import { useContext } from "react";
import { articleKeys } from "../articles";
import { SkipNetContext } from "../context";
import { infoBarClass } from "./classes";
import { DocumentIcon } from "./icons";

/** The npc folder: its articles listed as files, with when each was modified and its size. A click opens one */
export function FolderWindow() {
  const state = useContext(SkipNetContext);
  return (
    <div className="size-full flex flex-col">
      <div className={infoBarClass}>{articleKeys.length} items</div>
      <div className="@container flex-1 min-h-0 overflow-auto scrollbar-thin">
        <div className={cn(rowClass, "sticky top-0 bg-mac-window text-mac-muted border-b border-mac-edge")}>
          <span className="pl-6">Name</span>
          <span>Modified</span>
          <span className={sizeClass}>Size</span>
        </div>
        {articleKeys.map((articleKey) => {
          const stats = statsByKey[articleKey];
          return (
            <button
              key={articleKey}
              type="button"
              className={cn(rowClass, "w-full text-left cursor-pointer hover:bg-mac-text/10")}
              onClick={() => state.open({ kind: "article", articleKey })}
            >
              <span className="min-w-0 flex items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
                <DocumentIcon />
                <span className="truncate">{articleKey}</span>
              </span>
              <span className="text-mac-muted">{stats ? formatModified(stats.modifiedMs) : "--"}</span>
              <span className={cn(sizeClass, "text-mac-muted")}>{stats ? formatSize(stats.bytes) : "--"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Today by its time, else by its date */
function formatModified(ms: number) {
  const date = new Date(ms);
  return date.toDateString() === new Date().toDateString()
    ? `Today, ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatSize(bytes: number) {
  return bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KB`;
}

const rowClass = tw("grid grid-cols-[1fr_auto] @xs:grid-cols-[1fr_auto_4.5rem] gap-x-4 px-3 py-0.5");
/** Shown only in a window wide enough */
const sizeClass = tw("hidden @xs:block text-right");
