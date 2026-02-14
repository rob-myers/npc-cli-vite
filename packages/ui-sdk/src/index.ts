import type z from "zod";
import type { UiInstanceMeta } from "./schema";

export * from "./define-ui";
export * from "./schema";
export * from "./UiContext";
export * from "./UiErrorBoundary";
export * from "./UiInstanceMenu";
export * from "./UiParseError";
export * from "./ui.store";

export type UiBootstrapProps = {
  addInstance(partialUiMeta: { [key: string]: unknown }): void;
};

export type UiPackageDef = {
  // biome-ignore lint/suspicious/noExplicitAny: props validated by zod in defineUi
  ui: React.LazyExoticComponent<(props: any) => React.ReactNode>;
  bootstrap: null | ((props: UiBootstrapProps) => React.ReactNode);
  schema: z.ZodType<UiInstanceMeta>;
};

/** Raise UI above draggable area */
export const uiClassName = "relative z-1";
