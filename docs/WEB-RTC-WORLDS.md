# WebRTC Worlds

One `World` can join another as a **client**: an extra camera into the **server** World, with npcs, doors, decor, speech and play/pause mirrored over WebRTC DataChannels. Same-page works in PROD (in-memory signaling); cross-tab works in dev (signaling over Vite's HMR websocket). Cross-browser multiplayer is the eventual goal — the transport is already real WebRTC.

## Architecture

- **`w.net`** (`use-world-net.ts`) is the per-World networking sub-state, `mode: "idle" | "server" | "client"`. A World becomes a server lazily when its first client says hello; a client via `w.net.join(target)` from the WorldSpeech panel. An explicit join outranks serving: the clients are dismissed (`server-closed`) and restore themselves — which also unwedges a phantom client left by a refreshed/closed tab.
- **Two DataChannels** per peer: `"events"` (reliable ordered, JSON `WorldNetMessage`) and `"transforms"` (unordered, no retransmits, binary).
- **Client = mirror mode**: no navcat crowd, no physics npcs, no door policy, no persistence of its own. Mirrored npcs are agent-less (`npc.agentId === null` — `w.npc.onTick` already animates those without touching position); the transform stream drives `position`/`rotation.y`.
- **Joining adopts the server**: mapKey (via ui meta), full snapshot (npcs + playerKey, door open/locked, runtime decor, paused), and the client's persisted map store is overwritten with the server's state — so a refresh (or a failed reconnect) boots into it. The persist gates stop the client drifting from that save whilst connected.
- **Not passive**: client picks are computed locally (same geometry) and forwarded; the server re-emits them on its own bus with `srcWorld: "world-N"`, so shell scripts can tell where a click came from. Client play/pause requests route via the server, whose `disabled`/`enabled` events broadcast to every client (idempotency guards break the echo).

## New files

### `packages/ui/world/src/service/net-protocol.ts`
`WorldNetMessage` union (hello/ack, refused, snapshot, spawn, remove-npcs, npc-visibility, enter-room, door, speech, decor create/remove, set-paused, set-player, map-changed, pick, leave, server-closed) plus the binary transform codec: `u8 count`, then 19 bytes per npc — `u16 netId, f32 x/z/rotY/speed, u8 flags` (moving, run). `netId` is a compact server-assigned id carried by `snapshot`/`spawn`.

### `packages/ui/world/src/service/net-signaling.ts`
`Signaling` interface (offer/answer/ICE + join-request/bye, presence + roster) with two impls:
- `InMemorySignaling` — module-level map, same page only, works in PROD.
- `DevWsSignaling` — rides `import.meta.hot` custom event `world-rtc`; heartbeat announce, roster callbacks. Absent in PROD.

A page-scoped `pageId` disambiguates the same `worldKey` across tabs (`uid = ${pageId}/${worldKey}`); `sendSignal` picks the impl per target via `isSamePage`. It is pinned on `hot.data` so an HMR cannot remint it (this page's worlds would ghost into the roster as "another tab"); a `pagehide` goodbye drops closing tabs from rosters promptly.

### `packages/ui/world/src/components/use-world-net.ts`
The whole session lifecycle:
- **Server**: accept join (offerer, creates both channels), hello → hello-ack, snapshot on request, event-driven replication (subscribes `w.events`), ~16Hz dirty-checked transform sampler (a paused server goes quiet), pick re-emission with `srcWorld`.
- **Client**: map adoption (reuses the WorldMenu map-switch path), snapshot application, mirror interpolation (~120ms behind, bracketing samples; anim state follows the *rendered* sample so walk→idle lands without a jolt), `startMovingMirror`/`startIdle` transitions, `syncAnimation` from interpolated speed.
- **fadeSpawn mirroring**: a respawn > 0.1m is replayed as the client npc's own `fadeSpawn` (darken → teleport → undarken, ring included) with the server's angle; a token-guarded `fading` hold keeps the transform stream off them (a second teleport supersedes cleanly), and rejoining the stream eases via a decaying catch-up offset instead of jumping.
- **Auto-reconnect**: `netParent` (persisted per world: `{ worldKey, remote }`) lets a refreshed client re-join, taking over the boot from `onBootstrapMap`; on failure it shows "not found" and boots standalone (into the adopted save). The search is scoped by `remote` — worldKeys are only unique within a page, so a lost remote parent never silently resolves to this page's own world of the same key. A remote loss keeps `netParent` and retries once (~2s), same scoping — only an explicit leave forgets it.
- **HMR resilience**: unmount teardown is deferred (~1s) and cancelled by the fast-refresh effect bounce, so live sessions survive a save; long-lived callbacks are wrappers over state fields, so hot-swapped logic applies inside a living connection.
- **Reveal**: the visual half of `onBootstrapMap` (veil lift, unfold, floor fade, pan/hint), run after snapshots and after leaving — the client paths skip the bootstrap that normally does this.
- Dev console handle: `__worldNet["world-1"]`.

### `packages/ui/world/src/components/NetMenu.tsx`
The join UI, rendered in `WorldSpeech`'s panel: joinable Worlds (same-page via `uiStore`, other tabs via the ws roster; worlds that are themselves clients excluded), connection status + leave, and the reconnect searching / not-found rows (dismiss clears `netParent`). Also `NetBadge` — a dot on the speech toggle icon (green connected/serving, yellow in-flight, red not found), so connection state shows without opening the panel.

### `scripts/src/vite-plugin-world-rtc.ts`
Dev signaling relay on Vite's HMR websocket: announce → roster broadcast, signal → relay to the target uid, heartbeat expiry for closed tabs. Registered in `packages/app/vite.config.ts`, exported from `scripts/package.json`.

## Modified files

| File | Change |
|---|---|
| `World.tsx` | `useWorldNet(state)`; `net` + `client` (live boolean the mirror gates read) on `World.State`; `w.net.onTick` in the rAF loop before `w.npc.onTick` |
| `NPCs.tsx` | mirror gates: `placeNpcAt` skips agent/physics creation (early return), `spawn` skips player adoption, `onTick` skips the crowd update, `warmCrowd` no-ops |
| `use-world-events.ts` | replication sources + client gates (hull-door propagation, `tryCloseDoor`, long-press say, `persistNpcs`/`persistDecor` early-return); `map-settled` routes to snapshot-request / auto-reconnect; new event cases; decor persistence (`persistDecor`/`restoreDecor`, wired into bootstrap/change-map/restore-from-world/reset) |
| `npc.ts` | `fadeSpawn` accepts an explicit `angle` (overrides `facingTarget`) |
| `npc-animation.ts` | `startMovingMirror(run)` — the non-crowd tail of `startMoving`, for agent-less mirrors |
| `Decor.tsx` | runtime decor keeps its original defs (`runtime.defByKey`) and fires `decor-created`/`decor-removed` — feeds both persistence and replication |
| `WorldView.tsx` | every `picked` event carries `srcWorld: w.key`; clients also `w.net.forwardPick`; `veiled`/`setVeiled` keyed per `worldKey` |
| `Floor.tsx` | first-map unveil flag keyed per `worldKey` — two Worlds booting together no longer race (the loser used to keep its veil). Both this and the veil flag live in `service/world-flags.ts`: they survive HMR but reset with the pane, so a re-added World arrives flat behind the veil rather than flashing unfolded |
| `WorldSpeech.tsx` | tabbed panel — "worlds" (`<NetMenu />`) and "speech" (history); auto-closes on connect; `<NetBadge />` on the toggle icon |
| `WorldMenu.tsx` | `MenuSelect` exported; a manual map switch ends any session first |
| `use-world-player.ts` | `persist()` also persists decor |
| `storage.ts` | `WorldMapState.decor` (runtime decor defs, per map); `WorldSettings.netParent` (`{ worldKey, remote }`, auto-reconnect) |
| `jsh-cli.d.ts` | `PickEvent.srcWorld`; new events `net-changed`, `decor-created`, `decor-removed` |
| `world.css` | `.world-veil` gets a pulsing top-left dot, so a veiled world is distinguishable from a broken black canvas |

## Dynamic decor (standalone feature)

Runtime decor (`w.decor.create`/`remove`) is now persisted per world+map and evented. It rides the snapshot and live `decor` messages; a client clears its own on join and restores it on leave. Useful without networking: decor survives reload, is copied by `restoreFromWorld`, and cleared by reset.

## PROD vs dev

| | same page | cross tab |
|---|---|---|
| dev | in-memory signaling | `DevWsSignaling` + `worldRtcPlugin` |
| PROD | in-memory signaling | needs a real websocket `Signaling` impl (future) |

The protocol version (`worldNetProtocol`) is checked at hello; a mismatch refuses the join.
