import { themeApi } from "@npc-cli/theme";
import { uiClassName, uiStoreApi } from "@npc-cli/ui-sdk";
import { BasicPopover, cn } from "@npc-cli/util";
import { WebRtcPeer } from "./webrtc/WebRtcPeer";

export default function Global() {
  return (
    <div className="flex flex-col justify-center items-center h-full overflow-auto gap-4">
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
