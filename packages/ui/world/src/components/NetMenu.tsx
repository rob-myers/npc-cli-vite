import { isWorldUiMeta } from "@npc-cli/ui-sdk/discriminator";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, tw } from "@npc-cli/util";
import { warn } from "@npc-cli/util/legacy/generic";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { type ReactNode, useContext, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { isSamePage, type RemoteWorld, uidOf } from "../service/net-signaling";
import { queryClientApi } from "../service/query-client";
import { getWorldStore } from "../service/storage";
import type { State as WorldState } from "./World";
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
 * The other Worlds, a tab each, with what each is and a button to connect or disconnect — see `use-world-net`.
 * Candidates: same-page Worlds (via `uiStore`), plus other tabs' Worlds from the dev-ws roster. Lives in `WorldSpeech`'s panel.
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
  /** The world whose tab is shown, by uid */
  const [chosenUid, setChosenUid] = useState<null | string>(null);
  /** `disconnect` is armed by its first click and takes effect on a second within `confirmMs` */
  const [leaveArmed, setLeaveArmed] = useState(false);

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

  useEffect(() => {
    if (leaveArmed === false) return;
    const timeoutId = window.setTimeout(() => setLeaveArmed(false), confirmMs);
    return () => window.clearTimeout(timeoutId);
  }, [leaveArmed]);

  if (net === null) return null;

  const worlds: WorldTab[] = [
    ...samePageWorldKeys.map((worldKey): WorldTab => {
      // one in a never-viewed tab exists in `uiStore` but is unmounted, so a join would go nowhere
      const other = queryClientApi.get([worldKey]) as undefined | WorldState;
      return {
        uid: uidOf(worldKey),
        worldKey,
        target: worldKey,
        mapKey: other?.mapKey ?? null,
        where: "this page",
        mode: other?.net?.mode ?? "idle",
        clients: other?.net?.clients.size ?? null,
        npcs: other?.n == null ? null : Object.keys(other.n).length,
        live: other !== undefined,
      };
    }),
    // other tabs: same-page worlds also announce on the ws, so dropped here
    ...roster
      .filter((remote) => !isSamePage(remote.uid))
      .map(
        (remote): WorldTab => ({
          uid: remote.uid,
          worldKey: remote.worldKey,
          target: remote,
          mapKey: remote.mapKey,
          where: `tab ${remote.uid.split("/")[0]}`,
          mode: remote.mode,
          clients: null,
          npcs: null,
          live: true,
        }),
      ),
  ];
  const joinedUid = net.mode === "client" ? (net.server?.uid ?? null) : null;
  const chosen = worlds.find((x) => x.uid === chosenUid) ?? worlds.find((x) => x.uid === joinedUid) ?? worlds[0];

  const rowClassName = cn(
    "flex items-center gap-1 px-2 py-1 text-xs text-slate-300 border-b border-slate-700",
    big && "px-3 py-2 text-sm",
  );

  return (
    <div className={cn("flex flex-col text-xs text-slate-300", big && "text-sm")}>
      {net.mode === "server" && (
        <div className={rowClassName}>
          <span className="text-sky-300">
            serving {net.clients.size} client{net.clients.size === 1 ? "" : "s"}
          </span>
        </div>
      )}
      {net.mode !== "client" && net.reconnect !== null && (
        <div className={rowClassName}>
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
      )}

      {chosen === undefined ? (
        <div className="px-2 py-1 text-slate-500 italic">no other worlds</div>
      ) : (
        <>
          <div className={rowClassName}>
            <div role="tablist" className="flex min-w-0 flex-1 gap-3 overflow-x-auto scrollbar-thin">
              {worlds.map((world) => (
                <button
                  key={world.uid}
                  type="button"
                  role="tab"
                  aria-selected={world === chosen}
                  className={cn(
                    "flex shrink-0 cursor-pointer items-center gap-1",
                    world === chosen
                      ? "text-slate-100 underline underline-offset-4"
                      : "text-slate-500 hover:text-slate-300",
                  )}
                  onClick={() => {
                    setChosenUid(world.uid);
                    setLeaveArmed(false);
                  }}
                >
                  {world.uid === joinedUid && (
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        net.phase === "connected" ? "bg-green-400" : "bg-yellow-400",
                      )}
                    />
                  )}
                  {world.worldKey}
                </button>
              ))}
            </div>
            <button
              type="button"
              title="re-read this page's worlds"
              className="shrink-0 cursor-pointer text-slate-500 hover:text-slate-300"
              onClick={() => setNetTick((x) => x + 1)}
            >
              <ArrowClockwiseIcon className={big ? "size-4" : "size-3.5"} />
            </button>
          </div>

          <div role="tabpanel" className={cn("flex flex-col gap-1 px-2 py-2", big && "px-3")}>
            <WorldInfoRow label="map">{chosen.mapKey ?? "?"}</WorldInfoRow>
            <WorldInfoRow label="where">{chosen.where}</WorldInfoRow>
            <WorldInfoRow label="status">{statusOf(chosen, chosen.uid === joinedUid ? net.phase : null)}</WorldInfoRow>
            {chosen.npcs !== null && <WorldInfoRow label="npcs">{chosen.npcs}</WorldInfoRow>}

            {chosen.uid === joinedUid ? (
              <button
                type="button"
                className={cn(
                  worldButtonClass,
                  leaveArmed ? "border-red-400/70 text-red-300" : "border-slate-600 text-slate-300 hover:text-red-300",
                )}
                onClick={() => {
                  if (leaveArmed === false) return setLeaveArmed(true);
                  setLeaveArmed(false);
                  void net.leave().catch(warn);
                }}
              >
                {leaveArmed ? "confirm" : "disconnect"}
              </button>
            ) : (
              <button
                type="button"
                // a client cannot be joined, nor a world not live in its tab
                disabled={chosen.mode === "client" || chosen.live === false}
                title={chosen.mode === "client" ? "it is itself a client" : chosen.live ? undefined : "not open"}
                className={cn(
                  worldButtonClass,
                  "border-slate-600 text-sky-300 not-disabled:hover:border-sky-400/70 disabled:cursor-default disabled:text-slate-600",
                )}
                onClick={() => void net.join(chosen.target).catch(warn)}
              >
                connect
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** One fact about a world, its label dimmed */
function WorldInfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-12 shrink-0 text-slate-500">{label}</span>
      <span className="truncate">{children}</span>
    </div>
  );
}

/** What a world is doing: `joined` our phase if we are its client */
function statusOf(world: WorldTab, joined: null | string) {
  if (joined !== null) return `joined (${joined})`;
  if (world.mode === "server") return world.clients === null ? "serving" : `serving ${world.clients}`;
  return world.mode === "client" ? "a client" : "idle";
}

/** Another World, as its tab shows it. `target` is what `net.join` takes */
type WorldTab = {
  uid: string;
  worldKey: string;
  target: string | RemoteWorld;
  mapKey: null | string;
  where: string;
  mode: RemoteWorld["mode"];
  clients: null | number;
  npcs: null | number;
  live: boolean;
};

const worldButtonClass = tw("mt-1 cursor-pointer self-start rounded border px-2 py-0.5");

/** How long an armed `leave` waits for its confirm */
const confirmMs = 3000;
