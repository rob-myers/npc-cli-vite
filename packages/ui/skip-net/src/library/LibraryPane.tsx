import { useContext } from "react";
import { SkipNetContext } from "../context";
import { SessionBar } from "../SessionBar";
import type { SkipNetWindow } from "../schema";
import { useWindowSession } from "../use-window-session";
import JobsLibrary from "./JobsLibrary";
import { useSessionRunner } from "./use-session-runner";

/** The jobs library, run in a session: the window's, else the first whose World is ours */
export function LibraryPane({ win }: { win: SkipNetWindow }) {
  const { meta } = useContext(SkipNetContext);
  const session = useWindowSession(win, meta.worldKey);
  const runner = useSessionRunner(session.ttyMeta);

  return (
    <div className="size-full flex flex-col bg-term-dashboard text-term-foreground select-none">
      <SessionBar runner={runner} session={session} win={win} />
      <div className="flex-1 min-h-0 flex flex-col">
        <JobsLibrary
          uiId={`${meta.id}:${win.id}`}
          copiedSrc={runner.copiedSrc}
          onCopy={runner.copySrc}
          onRun={runner.runSrc}
        />
      </div>
    </div>
  );
}
