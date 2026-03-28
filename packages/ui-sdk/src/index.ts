// We intentially only export types here
import type z from "zod";
import type { UiInstanceMeta } from "./schema";

export type * from "./schema";
export type * from "./UiContext";
export type * from "./ui.store";

export type UiBootstrapProps = {
  addInstance(partialUiMeta: { [key: string]: unknown }): void;
};

export type UiPackageDef = {
  // biome-ignore lint/suspicious/noExplicitAny: props validated by zod in defineUi
  ui: React.LazyExoticComponent<(props: any) => React.ReactNode>;
  bootstrap: null | ((props: UiBootstrapProps) => React.ReactNode);
  schema: z.ZodType<UiInstanceMeta>;
};
