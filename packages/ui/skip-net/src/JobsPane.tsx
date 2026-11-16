import { Spinner } from "@npc-cli/util";
import { lazy, Suspense, useContext } from "react";
import { SkipNetContext } from "./context";
import type { SkipNetWindow } from "./schema";
import { useWindowSession } from "./use-window-session";

/** Lazy, so the `Jobs` chunk stays apart from SkipNet's */
const Jobs = lazy(() => import("@npc-cli/ui__jobs/Jobs"));

/** The process leaders of a session: the window's, else the first whose World is ours */
export function JobsPane({ win }: { win: SkipNetWindow }) {
  const state = useContext(SkipNetContext);
  const { ttyMeta } = useWindowSession(win, state.meta.worldKey);
  return (
    <Suspense fallback={<Spinner className="size-4 m-2" />}>
      <Jobs sessionKey={ttyMeta?.sessionKey} onSessionKey={(sessionKey) => state.setWindow(win.id, { sessionKey })} />
    </Suspense>
  );
}
