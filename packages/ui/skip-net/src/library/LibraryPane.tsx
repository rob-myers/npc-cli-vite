import { Spinner } from "@npc-cli/util";
import { Picker } from "@npc-cli/util/picker";
import { useContext } from "react";
import { SkipNetContext } from "../context";
import type { SkipNetLeaf } from "../schema";
import { usePaneSession } from "../use-pane-session";
import JobsLibrary from "./JobsLibrary";
import { useSessionRunner } from "./use-session-runner";

/** The jobs library, run in a session: the leaf's, else the first whose World is ours */
export function LibraryPane({ leaf, paneId }: { leaf: SkipNetLeaf; paneId: number }) {
  const state = useContext(SkipNetContext);
  const { meta } = state;
  const { ttyMetas, ttyMeta } = usePaneSession(leaf, meta.worldKey);
  const runner = useSessionRunner(ttyMeta);

  return (
    <div className="size-full flex flex-col bg-term-dashboard text-term-foreground select-none">
      <div className="shrink-0 flex items-center gap-2 px-2 pt-1">
        {ttyMeta === null ? (
          <span className="text-term-muted">[No sessions]</span>
        ) : (
          <Picker
            value={ttyMeta.sessionKey}
            options={ttyMetas.map((x) => x.sessionKey)}
            onChange={(sessionKey) => state.setLeaf(paneId, { ...leaf, sessionKey })}
            title="the session commands run in"
            popupClassName="skip-net"
          />
        )}
        {/* a clicked command has been queued, but has yet to lead a process */}
        {runner.spawning.src !== null && (
          <span className="text-term-accent" title={`running: ${runner.spawning.src}`}>
            <Spinner className="size-3.5" />
          </span>
        )}
        {runner.awaitedWorldKey !== null && (
          <span className="text-term-paused truncate">runs once {runner.awaitedWorldKey} is open</span>
        )}
      </div>
      <div className="flex-1 min-h-0">
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
