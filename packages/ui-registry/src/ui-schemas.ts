import { AudioUiMetaSchema } from "@npc-cli/ui__audio/schema";
import { BlogUiMetaSchema } from "@npc-cli/ui__blog/schema";
import { DecoratorUiMetaSchema } from "@npc-cli/ui__decorator/schema";
import { TemplateUiMetaSchema as JobsUiMetaSchema } from "@npc-cli/ui__jobs/schema";
import { JshUiSchema } from "@npc-cli/ui__jsh/schema";
import { ManifestUiMetaSchema } from "@npc-cli/ui__manifest/schema";
import { MapEditUiMetaSchema } from "@npc-cli/ui__map-edit/schema";
import { TabsUiMetaSchema } from "@npc-cli/ui__tabs/schema";
import { TemplateUiMetaSchema } from "@npc-cli/ui__template/schema";
import { WorldUiSchema } from "@npc-cli/ui__world/schema";
import type { UiRegistry, UiRegistryKey } from "./ui-registry";

/**
 * Each ui's schema without its lazy component: importing `uiRegistry` would name every ui chunk,
 * renaming whatever imports it (e.g. `ui.store`, so every ui) whenever any ui changes.
 */
export const uiSchemas = {
  Audio: AudioUiMetaSchema,
  Blog: BlogUiMetaSchema,
  Decorator: DecoratorUiMetaSchema,
  Jobs: JobsUiMetaSchema,
  Jsh: JshUiSchema,
  Manifest: ManifestUiMetaSchema,
  MapEdit: MapEditUiMetaSchema,
  Tabs: TabsUiMetaSchema,
  Template: TemplateUiMetaSchema,
  World: WorldUiSchema,
} satisfies { [K in UiRegistryKey]: UiRegistry[K]["schema"] };
