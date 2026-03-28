import { themeApi } from "@npc-cli/theme";
import { uiClassName } from "@npc-cli/ui-sdk/const";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { BasicPopover, cn } from "@npc-cli/util";
import { useContext } from "react";
import { WebRtcPeer } from "./webrtc/WebRtcPeer";

export default function Global() {
  const { uiStoreApi } = useContext(UiContext);

  return (
    <div className="flex flex-col items-center h-full overflow-auto gap-4">
      <div className="p-4 grid grid-cols-[minmax(2rem,auto)_minmax(2rem,auto)] w-48 gap-2">
        <button
          type="button"
          className={cn(
            uiClassName,
            "cursor-pointer",
            "overflow-auto border rounded",
            "flex justify-center items-center bg-button-background",
          )}
          onPointerDown={themeApi.setOther}
        >
          {themeApi.getOther()}
        </button>
        <BasicPopover
          triggerClassName={cn(
            uiClassName,
            "overflow-auto border rounded",
            "flex justify-center items-center bg-button-background",
          )}
          trigger={"reset"}
          side="bottom"
        >
          <button type="button" className="cursor-pointer" onPointerDown={uiStoreApi.resetLayout}>
            confirm
          </button>
        </BasicPopover>
      </div>
      <WebRtcPeer />
    </div>
  );
}
