import type { UiInstanceMeta } from "./ui.store";

export * from "./UiContext";
export * from "./ui.store";

export type UiProps = {
  id: string; // 🚧 remove?
  meta: UiInstanceMeta;
};

export type UiBootstrapProps = {
  addInstance(partialUiMeta: { [key: string]: unknown }): void;
};
