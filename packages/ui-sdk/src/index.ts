import type * as portals from "react-reverse-portal";
import type z from "zod";
import type { UiInstanceMeta } from "./schema";

export * from "./define-ui";
export * from "./schema";
export * from "./UiContext";
export * from "./UiErrorBoundary";
export * from "./UiInstance";
export * from "./UiParseError";
export * from "./ui.store";

export type UiProps = {
  meta: UiInstanceMeta;
  portalNode?: portals.HtmlPortalNode;
};

export type UiBootstrapProps = {
  addInstance(partialUiMeta: { [key: string]: unknown }): void;
};

export type UiPackageDef = {
  // biome-ignore lint/suspicious/noExplicitAny: props validated by zod in defineUi
  ui: React.LazyExoticComponent<(props: any) => React.ReactNode>;
  bootstrap: null | ((props: UiBootstrapProps) => React.ReactNode);
  schema: z.ZodType<UiInstanceMeta>;
};
