import { uiClassName } from "@npc-cli/ui-sdk/const";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { BasicPopover, cn } from "@npc-cli/util";
import { useContext } from "react";

export default function Layout() {
  const { uiStoreApi } = useContext(UiContext);

  return (
    <div className="flex flex-col items-center h-full overflow-auto gap-4">
      <div className="p-4 flex flex-wrap items-center h-full gap-2 *:px-2">
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
    </div>
  );
}
