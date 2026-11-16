import { useContext } from "react";
import { SkipNetContext } from "../context";
import { SessionBar } from "../SessionBar";
import type { SkipNetLeaf } from "../schema";
import { usePaneSession } from "../use-pane-session";
import JobsLibrary from "./JobsLibrary";
import { useSessionRunner } from "./use-session-runner";

/** The jobs library, run in a session: the leaf's, else the first whose World is ours */
export function LibraryPane({ leaf, paneId }: { leaf: SkipNetLeaf; paneId: number }) {
  const { meta } = useContext(SkipNetContext);
  const session = usePaneSession(leaf, meta.worldKey);
  const runner = useSessionRunner(session.ttyMeta);

  return (
    <div className="size-full flex flex-col bg-term-dashboard text-term-foreground select-none">
      <SessionBar leaf={leaf} paneId={paneId} runner={runner} session={session} />
      <div className="flex-1 min-h-0 flex flex-col">
        <JobsLibrary
          uiId={`${meta.id}:${paneId}`}
          copiedSrc={runner.copiedSrc}
          onCopy={runner.copySrc}
          onRun={runner.runSrc}
        />
      </div>
    </div>
  );
}
