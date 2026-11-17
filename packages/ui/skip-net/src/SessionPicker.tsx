import { Spinner, tw } from "@npc-cli/util";
import { Picker } from "@npc-cli/util/picker";
import { useContext } from "react";
import { SkipNetContext } from "./context";
import { InTitle } from "./desktop/InTitle";
import type { SessionRunner } from "./library/use-session-runner";
import type { SkipNetWindow } from "./schema";
import type { useWindowSession } from "./use-window-session";

/** In its window's title bar: its session, and whether a run is starting or awaits its World */
export function SessionPicker(props: Props) {
  const { runner, win } = props;
  const { ttyMetas, ttyMeta } = props.session;
  const state = useContext(SkipNetContext);

  return (
    <InTitle>
      {/* a clicked command has been queued, but has yet to lead a process */}
      {runner.spawning.src !== null && (
        <span title={`running: ${runner.spawning.src}`}>
          <Spinner className="size-3" />
        </span>
      )}
      {runner.awaitedWorldKey !== null && (
        <span className="text-mac-muted truncate" title={`runs once ${runner.awaitedWorldKey} is open`}>
          awaits {runner.awaitedWorldKey}
        </span>
      )}
      {ttyMeta === null ? (
        <span className="text-mac-muted">no tty</span>
      ) : (
        <Picker
          value={ttyMeta.sessionKey}
          options={ttyMetas.map((x) => x.sessionKey)}
          onChange={(sessionKey) => state.setWindow(win.id, { sessionKey })}
          title="the session commands run in"
          className={pickerClass}
          popupClassName={pickerPopupClass}
        />
      )}
    </InTitle>
  );
}

type Props = {
  runner: SessionRunner;
  session: ReturnType<typeof useWindowSession>;
  win: SkipNetWindow;
};

/** Small enough for a title bar, in the desktop's greys over `Picker`'s own */
const pickerClass = tw(
  "h-3.5 py-0 rounded-none border-0 bg-transparent text-mac-text text-[11px] leading-none hover:bg-mac-window",
);
const pickerPopupClass = tw(
  "rounded-none! border-mac-edge! bg-mac-window! text-mac-text! [&_[data-highlighted]]:bg-mac-select! [&_[data-highlighted]]:text-mac-on-select!",
);
