import { themeApi } from "@npc-cli/theme";
import { UiContext } from "@npc-cli/ui-sdk";
import { useContext } from "react";

export function Global() {
  const { layoutApi } = useContext(UiContext);

  return (
    <div className="flex justify-center items-center h-full overflow-auto">
      <div className="p-4 flex flex-wrap gap-2 justify-center">
        <button
          type="button"
          className="cursor-pointer border rounded px-4 py-1 bg-button-background"
          onPointerDown={themeApi.setOther}
        >
          {/* label is next theme */}
          {themeApi.getOther()}
        </button>
        <button
          type="button"
          className="cursor-pointer border rounded px-4 py-1 bg-button-background"
          onPointerDown={() => {
            layoutApi.resetLayout();
          }}
        >
          reset
        </button>
      </div>
    </div>
  );
}
