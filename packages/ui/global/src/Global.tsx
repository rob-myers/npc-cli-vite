import { themeApi } from "@npc-cli/theme";
import { uiClassName, uiStoreApi } from "@npc-cli/ui-sdk";
import { BasicPopover, cn } from "@npc-cli/util";

export default function Global() {
  return (
    <div className="flex justify-center items-center h-full overflow-auto">
      <div className="p-4 grid grid-cols-2 w-48 gap-2">
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
    </div>
  );
}
