import { themeApi } from "@npc-cli/theme";
import { uiStoreApi } from "@npc-cli/ui-sdk";
import { BasicPopover } from "@npc-cli/util";

export default function Global() {
  return (
    <div className="flex justify-center items-center h-full overflow-auto">
      <div className="p-4 flex flex-wrap gap-2 justify-center">
        <button
          type="button"
          className="cursor-pointer border rounded px-4 py-1 bg-button-background"
          onPointerDown={themeApi.setOther}
        >
          {themeApi.getOther()}
        </button>
        <BasicPopover
          triggerClassName="border rounded px-4 py-1 bg-button-background"
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
