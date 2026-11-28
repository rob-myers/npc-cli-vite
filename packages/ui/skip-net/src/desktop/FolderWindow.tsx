import statsByKey from "virtual:skip-net-articles";
import { cn, tw } from "@npc-cli/util";
import { Picker } from "@npc-cli/util/picker";
import { useContext } from "react";
import { articleFolders } from "../articles";
import { SkipNetContext } from "../context";
import type { SkipNetWindow } from "../schema";
import { titlePickerClass, titlePickerPopupClass } from "./classes";
import { InTitle } from "./InTitle";
import { DocumentIcon, VideoFileIcon } from "./icons";

/**
 * The files folder: a folder picked in its title bar, its articles beneath.
 * A click on an article opens it.
 */
export function FolderWindow({ win }: { win: SkipNetWindow }) {
  const state = useContext(SkipNetContext);
  /** A stale folder falls back to the first */
  const chosen = articleFolders.find((x) => x.key === win.folder) ?? articleFolders[0];
  const count = chosen?.articleKeys.length ?? 0;

  return (
    <div className="size-full flex flex-col">
      <InTitle>
        <Picker
          value={chosen?.key ?? ""}
          options={articleFolders.map((x) => x.key)}
          onChange={(folder) => state.setWindow(win.id, { folder })}
          title="the folder shown"
          className={cn(titlePickerClass, folderPickerClass)}
          popupClassName={cn(titlePickerPopupClass, "text-sm")}
        />
        <span className="text-mac-muted">{count === 1 ? "1 item" : `${count} items`}</span>
      </InTitle>
      <div className="@container flex-1 min-h-0 overflow-auto scrollbar-thin">
        <div className={cn(rowClass, "sticky top-0 bg-mac-window text-mac-muted border-b border-mac-edge")}>
          <span>Name</span>
          <span>Modified</span>
          <span className={sizeClass}>Size</span>
        </div>
        {chosen?.articleKeys.map((articleKey) => {
          const stats = statsByKey[articleKey];
          return (
            <button
              key={articleKey}
              type="button"
              className={cn(rowClass, rowButtonClass)}
              onClick={() => state.open({ kind: "article", articleKey })}
            >
              <span className={nameClass}>
                {chosen.key === "video" ? <VideoFileIcon /> : <DocumentIcon />}
                <span className="truncate">{articleKey}</span>
              </span>
              <Modified ms={stats?.modifiedMs} />
              <span className={cn(sizeClass, "text-mac-muted")}>{stats ? formatSize(stats.bytes) : "--"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** When it was modified, shorter in a narrow window */
function Modified({ ms }: { ms: undefined | number }) {
  return (
    <span className="text-mac-muted">
      {ms === undefined ? (
        "--"
      ) : (
        <>
          <span className="@[17rem]:hidden">{formatModified(ms, true)}</span>
          <span className="hidden @[17rem]:inline">{formatModified(ms)}</span>
        </>
      )}
    </span>
  );
}

/** Today by its time, else by its date. `short` drops "Today" and the year, for a narrow window */
function formatModified(ms: number, short = false) {
  const date = new Date(ms);
  if (date.toDateString() === new Date().toDateString()) {
    const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return short ? time : `Today, ${time}`;
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: short ? undefined : "numeric" });
}

function formatSize(bytes: number) {
  return bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KB`;
}

const rowClass = tw("grid grid-cols-[1fr_auto] @xs:grid-cols-[1fr_auto_4.5rem] gap-x-4 px-3 py-0.5");
const rowButtonClass = tw("w-full text-left cursor-pointer hover:bg-mac-text/10");
/** A row's icon and name */
const nameClass = tw("min-w-0 flex items-center gap-1.5 [&_svg]:size-4 [&_svg]:shrink-0");
/** Shown only in a window wide enough */
const sizeClass = tw("hidden @xs:block text-right");
/** A classic pop-up menu: the window's colour, boxed, with a hard drop shadow */
const folderPickerClass = tw(
  "h-5 px-2 text-sm rounded-sm border border-mac-edge bg-mac-window shadow-[1px_1px_0_var(--color-mac-shadow)] hover:bg-mac-window data-popup-open:bg-mac-text/15",
);
