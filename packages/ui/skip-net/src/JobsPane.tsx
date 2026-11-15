import { Spinner } from "@npc-cli/util";
import { lazy, Suspense, useContext } from "react";
import { SkipNetContext } from "./context";
import type { SkipNetLeaf } from "./schema";
import { usePaneSession } from "./use-pane-session";

/** Lazy, so the `Jobs` chunk stays apart from SkipNet's */
const Jobs = lazy(() => import("@npc-cli/ui__jobs/Jobs"));

/** The process leaders of a session: the leaf's, else the first whose World is ours */
export function JobsPane({ leaf, paneId }: { leaf: SkipNetLeaf; paneId: number }) {
  const state = useContext(SkipNetContext);
  const { ttyMeta } = usePaneSession(leaf, state.meta.worldKey);
  return (
    <Suspense fallback={<Spinner className="size-4 m-2" />}>
      <Jobs
        sessionKey={ttyMeta?.sessionKey}
        onSessionKey={(sessionKey) => state.setLeaf(paneId, { ...leaf, sessionKey })}
      />
    </Suspense>
  );
}
