import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { UiInstanceMeta } from "./schema";

/**
 * Not persisted: contents should be determined by persisted layout.
 */
export const uiStore = create<UiStoreState>()(
  immer(
    devtools(
      (_set, _get) => ({
        metaById: {},
      }),
      { name: "ui-store", anonymousActionType: "ui-store" },
    ),
  ),
);

export type UiStoreState = {
  metaById: { [id: string]: UiInstanceMeta };
};
