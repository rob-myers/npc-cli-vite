import { themeApi } from "@npc-cli/theme";
import { UiContext } from "@npc-cli/ui-sdk";
import { BasicPopover } from "@npc-cli/util";
import { useContext } from "react";

export default function Global() {
  const { layoutApi } = useContext(UiContext);

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
          className="border rounded px-4 py-1 bg-button-background"
          trigger={"reset"}
          side="bottom"
        >
          <button
            type="button"
            className="cursor-pointer"
            onPointerDown={() => layoutApi.resetLayout()}
          >
            confirm
          </button>
        </BasicPopover>
      </div>
    </div>
  );
}
