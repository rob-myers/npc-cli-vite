import { uiRegistry } from "@npc-cli/ui-registry";
import type { UiInstanceMeta, UiStoreByIdEntry } from "@npc-cli/ui-sdk";
import { UiErrorBoundary } from "@npc-cli/ui-sdk/UiErrorBoundary";
import { UiParseError } from "@npc-cli/ui-sdk/UiParseError";
import { uiStore } from "@npc-cli/ui-sdk/ui.store";
import { Spinner } from "@npc-cli/util";
import type React from "react";
import { Suspense, useMemo } from "react";
import * as portals from "react-reverse-portal";
import { useStore } from "zustand";

export const UiPortalContainer = () => {
  const byId = useStore(uiStore, (state) => state.byId);
  return (
    <div className="hidden">
      {Object.values(byId).map((entry) => (
        <UiPortal key={entry.meta.id} {...entry} />
      ))}
    </div>
  );
};

const UiPortal = ({ meta, portal, everSeen }: UiStoreByIdEntry) => {
  const def = uiRegistry[meta.uiKey];
  const C = def.ui as React.ComponentType<{ meta: UiInstanceMeta }>;
  const result = useMemo(() => def.schema.safeParse(meta), [def, meta]);

  return (
    <portals.InPortal key={meta.id} node={portal.portalNode}>
      {everSeen && (
        <UiErrorBoundary meta={meta}>
          <Suspense fallback={<Spinner />}>
            {result.success ? <C meta={result.data} /> : <UiParseError uiKey={meta.uiKey} zodError={result.error} />}
          </Suspense>
        </UiErrorBoundary>
      )}
    </portals.InPortal>
  );
};
