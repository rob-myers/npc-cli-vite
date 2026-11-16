import { Spinner } from "@npc-cli/util";
import { Picker } from "@npc-cli/util/picker";
import { type ReactNode, useContext } from "react";
import { SkipNetContext } from "./context";
import type { SessionRunner } from "./library/use-session-runner";
import type { SkipNetLeaf } from "./schema";
import type { usePaneSession } from "./use-pane-session";

/** A pane's session picker, then whether a run is starting or awaits its World */
export function SessionBar(props: Props) {
  const { leaf, paneId, runner } = props;
  const { ttyMetas, ttyMeta } = props.session;
  const state = useContext(SkipNetContext);

  return (
    <div className="shrink-0 flex items-center gap-2 px-2 pt-1">
      {props.children}
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
  );
}

type Props = {
  children?: ReactNode;
  leaf: SkipNetLeaf;
  paneId: number;
  runner: SessionRunner;
  session: ReturnType<typeof usePaneSession>;
};
