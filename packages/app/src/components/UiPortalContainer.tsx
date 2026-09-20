import { uiRegistry } from "@npc-cli/ui-registry";
import type { UiInstanceMeta, UiStoreByIdEntry } from "@npc-cli/ui-sdk";
import { recordUiLoad } from "@npc-cli/ui-sdk/analytics";
import { UiErrorBoundary } from "@npc-cli/ui-sdk/UiErrorBoundary";
import { UiParseError } from "@npc-cli/ui-sdk/UiParseError";
import { uiStore } from "@npc-cli/ui-sdk/ui.store";
import { Spinner } from "@npc-cli/util";
import type React from "react";
import { Suspense, useEffect, useMemo, useRef } from "react";
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
  // when the lazy chunk started loading; `ReportLoad` below closes the interval
  const startedAt = useRef(0);
  if (everSeen === true && startedAt.current === 0) startedAt.current = performance.now();

  return (
    <portals.InPortal key={meta.id} node={portal.portalNode}>
      {everSeen && (
        <UiErrorBoundary meta={meta}>
          <Suspense fallback={<Spinner />}>
            <ReportLoad meta={meta} startedAt={startedAt} />
            {result.success ? <C meta={result.data} /> : <UiParseError uiKey={meta.uiKey} zodError={result.error} />}
          </Suspense>
        </UiErrorBoundary>
      )}
    </portals.InPortal>
  );
};

/** Inside the boundary, so its effect runs only once the lazy chunk has arrived */
const ReportLoad = ({ meta, startedAt }: { meta: UiInstanceMeta; startedAt: React.RefObject<number> }) => {
  useEffect(() => {
    // `Tabs` is a container present in every pane, so it would be constant noise
    if (meta.uiKey === "Tabs") return;
    // re-fires on every HMR save, so `recordUiLoad` dedupes on `meta.id`
    recordUiLoad(meta.id, meta.uiKey, performance.now() - startedAt.current);
  }, [meta.id, meta.uiKey, startedAt]);
  return null;
};
