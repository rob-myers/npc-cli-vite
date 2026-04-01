import { themeApi } from "@npc-cli/theme";
import { uiClassName } from "@npc-cli/ui-sdk/const";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { BasicPopover, cn } from "@npc-cli/util";
import { useContext, useState } from "react";
import { WebRtcPeer } from "./webrtc/WebRtcPeer";

export default function Global() {
  const { uiStoreApi } = useContext(UiContext);
  const [showWebRtc, setShowWebRtc] = useState(false);

  return (
    <div className="flex flex-col items-center h-full overflow-auto gap-4">
      <div className="p-4 flex flex-wrap gap-2 *:px-2">
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
        <button
          type="button"
          className={cn(
            uiClassName,
            "cursor-pointer",
            "overflow-auto border rounded",
            "flex justify-center items-center bg-button-background",
            showWebRtc && "bg-on-background text-background",
          )}
          onPointerDown={() => setShowWebRtc((v) => !v)}
        >
          rtc
        </button>
      </div>
      {showWebRtc && <WebRtcPeer />}
    </div>
  );
}
