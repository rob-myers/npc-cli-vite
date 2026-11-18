import { Spinner } from "@npc-cli/util";
import { Picker } from "@npc-cli/util/picker";
import { lazy, Suspense, useContext } from "react";
import { articleKeys } from "../articles";
import { SkipNetContext } from "../context";
import { titlePickerClass, titlePickerPopupClass } from "../desktop/classes";
import { InTitle } from "../desktop/InTitle";
import type { SkipNetWindow } from "../schema";

const Comments = lazy(() => import("./Comments"));

/** A chat: a giscus thread, the general one or an article's, picked in its title bar */
export function ChatWindow({ win }: { win: SkipNetWindow }) {
  const state = useContext(SkipNetContext);
  const threadKey = threadKeys.find((x) => x === win.threadKey) ?? threadKeys[0];
  return (
    <div className="size-full overflow-auto scrollbar-thin p-3 bg-mac-window">
      <InTitle>
        <Picker
          value={threadKey}
          options={threadKeys}
          onChange={(threadKey) => state.setWindow(win.id, { threadKey })}
          title="the thread shown"
          className={titlePickerClass}
          popupClassName={titlePickerPopupClass}
        />
      </InTitle>
      <Suspense fallback={<Spinner className="size-4 m-2" />}>
        <Comments threadKey={threadKey} />
      </Suspense>
    </div>
  );
}

/** The general thread, then one per article */
const threadKeys = ["general", ...articleKeys];
