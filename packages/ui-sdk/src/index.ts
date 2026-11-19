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
  /** Lazy, unless it is on screen from the first render, e.g. `Tabs` */
  ui: React.LazyExoticComponent<(props: any) => React.ReactNode> | ((props: any) => React.ReactNode);
  /** Shown whilst a lazy `ui` loads, else a spinner */
  loading?: () => React.ReactNode;
  bootstrap: null | ((props: UiBootstrapProps) => React.ReactNode);
  schema: z.ZodType<UiInstanceMeta>;
  /** It scales itself by `meta.zoom`, so `Tabs` leaves it unzoomed */
  ownZoom?: true;
  /** Its tab's theme unless one is chosen, else the page's */
  defaultTheme?: import("@npc-cli/theme").ThemeName;
};
