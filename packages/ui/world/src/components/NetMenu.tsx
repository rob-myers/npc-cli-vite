import { isWorldUiMeta } from "@npc-cli/ui-sdk/discriminator";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn } from "@npc-cli/util";
import { warn } from "@npc-cli/util/legacy/generic";
import { useContext, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { isSamePage, type RemoteWorld } from "../service/net-signaling";
import { queryClientApi } from "../service/query-client";
import { getWorldStore } from "../service/storage";
import type { State as WorldState } from "./World";
import { MenuSelect } from "./WorldMenu";
import { WorldContext } from "./world-context";

/**
 * Connection state at a glance, without opening the panel — a dot on the speech toggle icon.
 * Green connected/serving, yellow in-flight (connecting, syncing, reconnecting), red not found.
 */
export function NetBadge() {
  const w = useContext(WorldContext);
  const [, setTick] = useState(0);

  useEffect(() => {
    const sub = w.events.subscribe({ next: (e) => e.key === "net-changed" && setTick((x) => x + 1) });
    return () => sub.unsubscribe();
  }, []);

  const net = w.net;
  if (net === null || (net.mode === "idle" && net.phase === "idle" && net.reconnect === null)) return null;

  return (
    <span
      className={cn(
        "absolute top-0.5 right-0.5 size-2 rounded-full pointer-events-none",
        net.reconnect?.status === "not-found"
          ? "bg-red-400"
          : net.mode === "server" || net.phase === "connected"
            ? "bg-green-400"
            : "bg-yellow-400 animate-pulse",
      )}
    />
  );
}

/**
 * Join another world as a client of it, or show/leave the current session — see `use-world-net`.
 * Candidates: same-page Worlds (via `uiStore`), plus other tabs' Worlds from the dev-ws roster.
 * A world that is itself a client cannot be joined. Lives in `WorldSpeech`'s panel.
 */
export function NetMenu() {
  const w = useContext(WorldContext);
  const { uiStore } = useContext(UiContext);
  const big = w.touchDevice;
  const net = w.net;

  const samePageWorldKeys = uiStore(
    useShallow(({ byId }) =>
      Object.values(byId).flatMap((ui) =>
        isWorldUiMeta(ui.meta) && ui.meta.worldKey !== w.key ? ui.meta.worldKey : [],
      ),
    ),
  );

  const [roster, setRoster] = useState<RemoteWorld[]>([]);
  const [, setNetTick] = useState(0);

  useEffect(() => {
    // re-render on session changes, and follow other tabs' worlds whilst the panel is open
    const sub = w.events.subscribe({
      next: (e) => e.key === "net-changed" && setNetTick((x) => x + 1),
    });
    const offRoster = net?.signalingWs?.onRoster(setRoster) ?? (() => {});
    return () => {
      sub.unsubscribe();
      offRoster();
    };
  }, []);

  if (net === null) return null;

  const rowClassName = cn(
    "flex items-center gap-1 px-2 py-1 text-xs text-slate-300 border-b border-slate-700",
    big && "px-3 py-2 text-sm",
  );

  if (net.mode === "client") {
    return (
      <div className={rowClassName}>
        <span className="text-slate-500">world:</span>
        <span className={cn("truncate", net.phase === "connected" ? "text-green-400" : "text-yellow-400")}>
          {net.server?.worldKey ?? "?"} ({net.phase})
        </span>
        <button
          type="button"
          className="ml-auto cursor-pointer text-slate-500 hover:text-red-300"
          onClick={() => void net.leave().catch(warn)}
        >
          leave
        </button>
      </div>
    );
  }

  if (net.mode === "server") {
    return (
      <div className={rowClassName}>
        <span className="text-slate-500">world:</span>
        <span className="text-sky-300">
          serving {net.clients.size} client{net.clients.size === 1 ? "" : "s"}
        </span>
      </div>
    );
  }

  if (net.reconnect !== null) {
    return (
      <div className={rowClassName}>
        <span className="text-slate-500">world:</span>
        {net.reconnect.status === "searching" ? (
          <span className="text-yellow-400">reconnecting to {net.reconnect.worldKey}…</span>
        ) : (
          <>
            <span className="text-red-300">{net.reconnect.worldKey} not found</span>
            <button
              type="button"
              className="ml-auto cursor-pointer text-slate-500 hover:text-slate-300"
              onClick={() => {
                net.reconnect = null;
                getWorldStore(w.key).patch({ netParent: null }); // stop trying on later loads
                // via the bus, so the `NetBadge` clears too
                w.events.next({ key: "net-changed", mode: net.mode, phase: net.phase });
              }}
            >
              dismiss
            </button>
          </>
        )}
      </div>
    );
  }

  // a world that is itself a client cannot be joined; nor can one that is not LIVE — e.g. in
  // a never-viewed tab it exists in `uiStore` but is unmounted, and a join would go nowhere
  const joinable = [
    ...samePageWorldKeys.flatMap((worldKey) => {
      const other = queryClientApi.get([worldKey]) as undefined | WorldState;
      if (other === undefined || other.net?.mode === "client") return [];
      return { key: worldKey, value: worldKey };
    }),
    // other tabs — same-page worlds also announce on the ws, so drop them here
    ...roster.flatMap(({ uid, worldKey, mode }) =>
      isSamePage(uid) === false && mode !== "client"
        ? { key: `${worldKey} (tab ${uid.split("/")[0]})`, value: uid }
        : [],
    ),
  ];

  if (joinable.length === 0) return null;

  return (
    <div className={rowClassName}>
      <span className="text-slate-500">world:</span>
      <MenuSelect
        className="flex-1"
        label="join world…"
        side="bottom"
        value={null}
        items={joinable}
        onValueChange={(value) => {
          if (value === null) return;
          const target = value.includes("/") ? roster.find((r) => r.uid === value) : value;
          if (target !== undefined) void net.join(target).catch(warn);
        }}
      />
    </div>
  );
}
