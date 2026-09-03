import type { Plugin } from "vite";

/** What `server.hot.on` hands us per message — enough to address one tab */
type HotClient = { send: (event: string, payload?: unknown) => void };

/**
 * Dev-only WebRTC signaling relay for World-to-World multiplayer — see
 * `packages/ui/world/src/service/net-signaling.ts` (`DevWsSignaling`).
 *
 * Rides Vite's HMR websocket (custom event `world-rtc`): worlds announce themselves
 * (heartbeat), the server broadcasts the roster, and relays offer/answer/ICE between uids.
 * PROD needs a real websocket server behind the same `Signaling` interface.
 */

const EVENT = "world-rtc";
const STALE_MS = 15_000;

type WireMsg =
  | { type: "announce"; from: string; info: { worldKey: string; mapKey: string; mode: string } }
  | { type: "goodbye"; from: string }
  | { type: "signal"; from: string; to: string; msg: unknown };

export function worldRtcPlugin(): Plugin {
  const peers = new Map<string, { client: HotClient; info: object; lastSeen: number }>();
  let pruneTimer: NodeJS.Timeout | undefined;

  return {
    name: "world-rtc",

    configureServer(server) {
      const broadcastRoster = () => {
        const worlds = [...peers.entries()].map(([uid, { info }]) => ({ uid, ...info }));
        server.hot.send(EVENT, { type: "roster", worlds });
      };

      server.hot.on(EVENT, (data: WireMsg, client) => {
        if (data.type === "announce") {
          peers.set(data.from, { client, info: data.info, lastSeen: Date.now() });
          broadcastRoster();
        } else if (data.type === "goodbye") {
          if (peers.delete(data.from)) broadcastRoster();
        } else if (data.type === "signal") {
          peers.get(data.to)?.client.send(EVENT, data);
        }
      });

      // heartbeat expiry covers closed tabs, without a per-socket close hook
      pruneTimer = setInterval(() => {
        const cutoff = Date.now() - STALE_MS;
        let changed = false;
        for (const [uid, { lastSeen }] of peers) {
          if (lastSeen < cutoff) {
            peers.delete(uid);
            changed = true;
          }
        }
        if (changed) broadcastRoster();
      }, 5_000);

      server.httpServer?.on("close", () => clearInterval(pruneTimer));
    },
  };
}
