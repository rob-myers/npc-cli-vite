import { uiRegistry } from "@npc-cli/ui-registry";
import {
  UiErrorBoundary,
  type UiInstanceMeta,
  UiParseError,
  type UiStoreByIdEntry,
  uiStore,
} from "@npc-cli/ui-sdk";
import { Spinner } from "@npc-cli/util";
import type React from "react";
import { Suspense, useMemo } from "react";
import * as portals from "react-reverse-portal";
import { useStore } from "zustand";

export const UiPortalContainer = () => {
  const byId = useStore(uiStore, (state) => state.byId);
  return (
    <div className="hidden">
      {Object.values(byId).map(({ meta, portal }) => (
        <UiPortal key={meta.id} meta={meta} portal={portal} />
      ))}
    </div>
  );
};

const UiPortal = ({ meta, portal }: UiStoreByIdEntry) => {
  const def = uiRegistry[meta.uiKey];
  const C = def.ui as React.ComponentType<{ meta: UiInstanceMeta }>;
  const result = useMemo(() => def.schema.safeParse(meta), [def, meta]);

  return (
    <portals.InPortal key={meta.id} node={portal.portalNode}>
      <UiErrorBoundary meta={meta}>
        <Suspense fallback={<Spinner />}>
          {result.success ? (
            <C meta={result.data} />
          ) : (
            <UiParseError uiKey={meta.uiKey} zodError={result.error} />
          )}
        </Suspense>
      </UiErrorBoundary>
    </portals.InPortal>
  );
};
