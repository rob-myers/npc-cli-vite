import { create } from "zustand";

/**
 * Not persisted: contents should be determined by persisted layout.
 */
export const uiStore = create<UiStoreState>()(
  (_set, _get): UiStoreState => ({
    metaById: {},
  }),
);

type UiStoreState = {
  metaById: { [layoutId: string]: Record<string, unknown> };
};
