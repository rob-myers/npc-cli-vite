import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { isUiOnScreen } from "@npc-cli/ui-sdk/ui.store";
import { cn, Spinner, Tip, tw } from "@npc-cli/util";
import { Picker } from "@npc-cli/util/picker";
import { useContext } from "react";
import { SkipNetContext } from "./context";
import { titlePickerClass, titlePickerPopupClass } from "./desktop/classes";
import { InTitle } from "./desktop/InTitle";
import type { SkipNetWindow } from "./schema";
import type { SessionRunner } from "./use-session-runner";
import type { useWindowSession } from "./use-window-session";

/** In its window's title bar: its session, and whether a run is starting or awaits its World */
export function SessionPicker(props: Props) {
  const { runner, win } = props;
  const { ttyMetas, ttyMeta } = props.session;
  const state = useContext(SkipNetContext);
  const { layoutApi, uiStore } = useContext(UiContext);
  const onScreen = uiStore((s) => ttyMeta === null || isUiOnScreen(s, ttyMeta.id));

  return (
    <InTitle>
      {/* a clicked command has been queued, but has yet to lead a process */}
      {runner.spawning.src !== null && (
        <Tip content={`running: ${runner.spawning.src}`}>
          <span className="p-1">
            <Spinner className="size-3" />
          </span>
        </Tip>
      )}
      {runner.awaitedWorldKey !== null && (
        <Tip content={`runs once ${runner.awaitedWorldKey} is open`}>
          <span className="text-mac-muted truncate">awaits {runner.awaitedWorldKey}</span>
        </Tip>
      )}
      {ttyMeta === null ? (
        <span className="text-term-danger">no tty</span>
      ) : (
        <>
          <Picker
            value={ttyMeta.sessionKey}
            options={ttyMetas.map((x) => x.sessionKey)}
            onChange={(sessionKey) => state.setWindow(win.id, { sessionKey })}
            title={onScreen ? "the session commands run in" : `${ttyMeta.sessionKey} is not on screen`}
            className={cn(titlePickerClass, "shrink-0", !onScreen && offScreenClass)}
            popupClassName={titlePickerPopupClass}
          />
          {!onScreen && (
            <Tip content={`bring ${ttyMeta.sessionKey} on screen`}>
              <button type="button" className={offScreenButtonClass} onClick={() => layoutApi.showUi(ttyMeta.id)}>
                show
              </button>
            </Tip>
          )}
        </>
      )}
    </InTitle>
  );
}

/** Amber, its tty being a hidden tab or in a hidden pane */
const offScreenClass = tw("text-amber-700 dark:text-amber-400");
const offScreenButtonClass = tw(
  "skip-net-no-drag shrink-0 h-3.5 px-1 text-[11px] leading-none cursor-pointer text-mac-text hover:bg-mac-select/15",
);

type Props = {
  runner: SessionRunner;
  session: ReturnType<typeof useWindowSession>;
  win: SkipNetWindow;
};
