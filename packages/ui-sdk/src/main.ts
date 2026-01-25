import type { UiInstanceMeta } from "./ui.store";

export * from "./UiContext";
export * from "./UiError";
export * from "./ui.store";

export type UiProps = {
  id: string; // 🚧 remove
  meta: UiInstanceMeta;
};

export type UiBootstrapProps = {
  addInstance(partialUiMeta: { [key: string]: unknown }): void;
};

export type UiPackageDef = {
  ui: React.LazyExoticComponent<(props: UiProps) => React.ReactNode>;
  bootstrap?: (props: UiBootstrapProps) => React.ReactNode;
};

export const defineUi = (uiDef: UiPackageDef) => uiDef;
