import type { UiRegistry } from "@npc-cli/ui-registry";
import { Spinner } from "@npc-cli/util";
import { Suspense } from "react";
import type { UiInstanceMeta } from ".";
import { UiErrorBoundary } from "./UiErrorBoundary";

export function UiInstance({ meta, uiRegistry }: { meta: UiInstanceMeta; uiRegistry: UiRegistry }) {
  const def = uiRegistry[meta.uiKey];
  return (
    <UiErrorBoundary meta={meta}>
      <Suspense fallback={<Spinner />}>
        <def.ui meta={meta} />
      </Suspense>
    </UiErrorBoundary>
  );
}
