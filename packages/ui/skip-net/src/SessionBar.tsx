import { Spinner, tw } from "@npc-cli/util";
import { Picker } from "@npc-cli/util/picker";
import { type ReactNode, useContext } from "react";
import { SkipNetContext } from "./context";
import { infoBarClass } from "./desktop/classes";
import type { SessionRunner } from "./library/use-session-runner";
import type { SkipNetWindow } from "./schema";
import type { useWindowSession } from "./use-window-session";

/** A window's info bar: its session, then whether a run is starting or awaits its World */
export function SessionBar(props: Props) {
  const { runner, win } = props;
  const { ttyMetas, ttyMeta } = props.session;
  const state = useContext(SkipNetContext);

  return (
    <div className={infoBarClass}>
      {props.children}
      {ttyMeta === null ? (
        <span className="text-mac-muted">[No sessions]</span>
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
      {/* a clicked command has been queued, but has yet to lead a process */}
      {runner.spawning.src !== null && (
        <span title={`running: ${runner.spawning.src}`}>
          <Spinner className="size-3.5" />
        </span>
      )}
      {runner.awaitedWorldKey !== null && (
        <span className="text-mac-muted truncate">runs once {runner.awaitedWorldKey} is open</span>
      )}
    </div>
  );
}

type Props = {
  children?: ReactNode;
  runner: SessionRunner;
  session: ReturnType<typeof useWindowSession>;
  win: SkipNetWindow;
};

/** In the desktop's greys, over `Picker`'s own */
const pickerClass = tw("rounded-none border-mac-edge bg-mac-window text-mac-text hover:bg-mac-title");
const pickerPopupClass = tw(
  "rounded-none! border-mac-edge! bg-mac-window! text-mac-text! [&_[data-highlighted]]:bg-mac-select! [&_[data-highlighted]]:text-mac-on-select!",
);
