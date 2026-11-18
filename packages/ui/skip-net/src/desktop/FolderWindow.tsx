import statsByKey from "virtual:skip-net-articles";
import { cn, tw } from "@npc-cli/util";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import { Fragment, useContext } from "react";
import { articleFolders } from "../articles";
import { SkipNetContext } from "../context";
import type { SkipNetWindow } from "../schema";
import { InTitle } from "./InTitle";
import { DocumentIcon, FolderIcon } from "./icons";

/**
 * The files folder: its folders as a tree, each opened or closed in place, their articles beneath.
 * A click on an article opens it.
 */
export function FolderWindow({ win }: { win: SkipNetWindow }) {
  const state = useContext(SkipNetContext);
  const openKeys = win.openFolders ?? articleFolders.map((x) => x.key);
  const toggle = (key: string) =>
    state.setWindow(win.id, {
      openFolders: openKeys.includes(key) ? openKeys.filter((x) => x !== key) : [...openKeys, key],
    });

  return (
    <div className="size-full flex flex-col">
      <InTitle>
        <span className="text-mac-muted">{articleFolders.length} items</span>
      </InTitle>
      <div className="@container flex-1 min-h-0 overflow-auto scrollbar-thin">
        <div className={cn(rowClass, "sticky top-0 bg-mac-window text-mac-muted border-b border-mac-edge")}>
          <span>Name</span>
          <span>Modified</span>
          <span className={sizeClass}>Size</span>
        </div>
        {articleFolders.map((folder) => {
          const open = openKeys.includes(folder.key);
          const Caret = open ? CaretDownIcon : CaretRightIcon;
          const modifiedMs = Math.max(0, ...folder.articleKeys.map((x) => statsByKey[x]?.modifiedMs ?? 0));
          return (
            <Fragment key={folder.key}>
              <button
                type="button"
                aria-expanded={open}
                className={cn(rowClass, rowButtonClass)}
                onClick={() => toggle(folder.key)}
              >
                <span className={nameClass}>
                  <Caret weight="fill" className="size-3!" />
                  <FolderIcon />
                  <span className="truncate">{folder.key}</span>
                </span>
                <Modified ms={modifiedMs || undefined} />
                <span className={cn(sizeClass, "text-mac-muted")}>{folder.articleKeys.length} items</span>
              </button>
              {open &&
                folder.articleKeys.map((articleKey) => {
                  const stats = statsByKey[articleKey];
                  return (
                    <button
                      key={articleKey}
                      type="button"
                      className={cn(rowClass, rowButtonClass)}
                      onClick={() => state.open({ kind: "article", articleKey })}
                    >
                      <span className={cn(nameClass, "pl-4.5")}>
                        <DocumentIcon />
                        <span className="truncate">{articleKey}</span>
                      </span>
                      <Modified ms={stats?.modifiedMs} />
                      <span className={cn(sizeClass, "text-mac-muted")}>{stats ? formatSize(stats.bytes) : "--"}</span>
                    </button>
                  );
                })}
            </Fragment>
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
/** A row's icons and name. A folder's caret leads, so its articles are indented by as much */
const nameClass = tw("min-w-0 flex items-center gap-1.5 [&_svg]:size-4 [&_svg]:shrink-0");
/** Shown only in a window wide enough */
const sizeClass = tw("hidden @xs:block text-right");
