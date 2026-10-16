# MCP server

The ONLY doc for the `npc-cli` MCP server. It lets Claude drive the running app: try a line in a tty, keep
what works as TypeScript, run it, and see what happened.

## Setup

- Run `pnpm dev`. It serves on `DEV_PORT`, 5173 by default.
- Claude Code starts the server from `.mcp.json` (`node --import=tsx scripts/src/mcp/server.ts`). `/mcp`
  lists it as `npc-cli`.
- On first use it attaches to Chrome on CDP port `NPC_MCP_CDP_PORT` (9382). If none is running, it
  launches a visible one with its own profile, and opens the dev page there.

## The page side

`packages/app/src/dev-mcp-hooks.ts` is a zustand store, exposed as `window.__devMcp`. Its methods are on
`window.__devMcp.getState()`:

- opening ttys, running lines in them, and reading what they print;
- `query`, which runs a function on the World;
- `worldToClient`, which projects a world point onto the screen;
- `refetch(queryKey)`, which refetches the app's queries by key, e.g. `["skins-and-gltf"]`.

Loading:

- It is DEV only.
- It loads on first use (`window.__devMcpLoad`), once the World has a canvas, not at boot. It imports the
  shell, and loading that early changes the order the app's modules load in.
- That once broke the app: the shell's `wasm_exec.js` stubbed a global `process` with no `env`, and
  `polygon-clipping` read it on load. The stub now has an `env`.

## Tools

| Tool | What it does |
|---|---|
| `jsh({ cmd, tty?, waitMs?, typed? })` | Runs one line in a tty, `tty-1` by default, typed visibly unless `typed: false`. Returns once the prompt is back, else after `waitMs` (2000) with the command still running |
| `output({ tty?, since? })` | What was written to the tty since a previous result's `since` |
| `interrupt({ tty? })` | Ctrl-c: ends the foreground command, so the tty takes input again |
| `query({ fn, world?, depth? })` | Runs `fn`, JS source such as `w => w.gms[0].rooms.length`, on the World and returns JSON. Writes to no tty. It runs in the page, so `window` is in reach |
| `click({ x, z, y? } \| { clientX, clientY }, long?, button? })` | A real pointer press, e.g. to answer `pick`. A world point is projected by the camera |
| `console({ since?, level? })` | The page's console and exceptions, e.g. an HMR error. `level: "debug"` shows Vite's `hot updated` lines |
| `shot()` | A screenshot |

Each result ends with a status line, e.g. `{"running":false,"exitCode":0,"since":42}`.

About ttys:

- A tty opens as a tab beside `tty-0` the first time it is used.
- A tty busy with a foreground command refuses a typed line. Read its output, or interrupt it.
- Run a long command as a background job (`… &`) to keep the tty free.
- Use another tty, e.g. `tty-2`, when one's output would bury another's.
- Each tty has its own `~` (`/home`). Data that two ttys share goes in `/shared`.

## Working

1. Prototype in a tty: pipelines, `map`, `w n.rob.anim.fast`.
2. Keep what is reusable as an exported function of a `packages/cli/src/jsh/world/*_mcp.ts` module,
   `demo_mcp.ts` first. Write it like the commands in `core.ts`. A new module must be added to
   `modules.js` and to the profile's `source /etc/{…}.js.sh`.
3. Check it loaded: `jsh({ cmd: "declare -F" })`, or `console` for an error.
4. Run it, interactively if need be. For example, `jsh({ cmd: "events 'e => e.key === \"enter-collider\"' | foo &" })`,
   then `jsh({ cmd: "move rob to:[…]" })`, then `output()`.

A World query longer than a line of `w` is a JS function too, e.g. in a `debug_mcp.ts`. It reads the World
from `ct.w` and returns plain data.

## Rules

### The shared tty

- **The user watches the tty.** Keep lines short and typed (`typed: true`), e.g. `npcs`, `move …`, `say …`.
- **Read bulk or exploratory state with `query`.** Never a long `w '…'` that floods the tty.
- **To switch tabs, type a line there.** A typed line brings its tty to the front.

### World state

- **Unpause before a test moves, turns or arms anyone.** The World is often paused, e.g. after a reload.
  Then a `move` waits, a `look` never finishes, and just after load `npcs` may print `[]`. Unpause with
  `query` `w => w.setDisabled(false)`, and again after anything that pauses, e.g. `w.npcFocus.open`.
- **Put back the view settings a session changed**, unless asked to keep them. Follow
  (`w view.setFollow true`) and the fade mode are saved.
- **Choose the fade mode for the session's aim.** Use `sight` to see what the player sees. `sense` or
  `ship` are fine otherwise, e.g. to debug many npcs (`w view.setFadeRoomsMode ship`). In `sight` an unlit
  room cannot be picked, so a `click` there does nothing useful.
- **Subscribe to `w.events` with `{ next }`**, never a bare function. A bare function makes EVERY event
  throw "listener is not a function" until it is unsubscribed, which breaks the user's commands meanwhile.

### Clicking and the view

- **`click` a world point only when it is on-screen.** Otherwise point the camera there first with
  `w view.lookAt '{ x, y }'`. Turn follow off first, or it pulls back to the player.
- **To show the player, use `w view.holdFrontier`.** It is the look button's short press, framing them and
  their frontier. `w view.onLookGesture false` is the press itself, but it stops a follow instead of looking.

## While Claude drives the page

### Showing each call's input

The VS Code extension shows an MCP call's result (OUT) but not its input (IN). So Claude writes the input
in its own message, as a code fence, just BEFORE each call:

- the `jsh` line in an `sh` fence,
- the `query` function in a `js` fence,
- anything else as its arguments.

That message is the fence ALONE. With a sentence in front, the extension condenses the message and the
fence is lost. Putting the input in the result does not work either: the extension collapses a result.

The session transcript has both. Follow it with:

```sh
tail -f ~/.claude/projects/-Users-robmyers-coding-npc-cli-vite/<session-id>.jsonl | jq -c --unbuffered \
  'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and (.name|startswith("mcp__npc-cli"))) | {name: (.name|sub("mcp__npc-cli__";"")), input}'
```

The Claude Code CLI shows the input inline, and `claude --resume` opens the same session there.

### "mcp testing"

The World's busy overlay says "mcp testing" from Claude's first call in a turn until the turn ends
(`driving` in `dev-mcp-hooks.ts`).

- Every call starts it, except `console`, `shot` and a `click` at client coordinates.
- A `Stop` hook in `.claude/settings.local.json` ends it. The hook posts to `/api/dev-mcp/turn-end`, and
  `vite-plugin-dev-mcp` passes that to the page as the HMR event `dev-mcp:turn-end`.

### The user's own input

Whilst "mcp testing" is up, the page logs the user's `pointerdown`, `keydown` and `wheel`.

- Claude's own `click` is not logged: it marks itself first with `ignoreInputFor`.
- Each text result ends with `[user input since last call: …]` when there was any (`takeUserInput`).
- **That line means the user has taken over. Stop and ask before going on.**
- **If state seems off mid-test, ask whether the user interacted** before calling it a bug.

## Recipes

### Beds and decor

- **Into a bed without `pick`**: pipe the decor point itself, which carries `meta.do`:
  `w 'w => w.decor.byKey["g0r3-point-0_76-0_51-11_09"]' | move npc:rob`.
  - Find keys with `query` over `w.decor.byRoom`.
  - `w.decor.runtime.byKey` holds runtime decor only, not a map's own.
  - The shell drops a piped `undefined`, so a wrong key pipes nothing and still exits `0`. Check the key
    with `query` first.
- **Picking a bed or sofa** gives its obstacle's meta (`decorIds`). `move` takes its free point nearest
  the point picked.
- **A free bed in a room**: `w.gms[gmId].obstacles` meta has its kind (`bed`, `chair`), `roomId` and
  `decorIds`. A point is taken iff `w.e.doableToNpc[w.gms[gmId].decor[id].key]`. `w.decor.byRoom` and
  `w.decor.grid` index decor too.
- **Put points in decor, not in the command**, so they can be dragged in the Decorator:
  `decor to:[15.75,7.75] key:patrol-bot2-0`. Read them back by key prefix with `route patrol-bot2-`.

### Placing and moving

- **A room's centre may be off the navmesh**, e.g. under an obstacle, and then `move` fails with
  `not navigable`. Place away from the room's obstacles, read from `w.gms[gmId].obstacles` by `meta.roomId`.
- **Spawn with a skin, then look**: `spawn npc:bot0 at:[14.5,0,5] skin:robot-0`, then
  `look bot0 at:rob; look bot1 at:rob`. `;` chains lines.
- **A patrol is a background job**, so the tty stays free: `patrol_route bot2 patrol-bot2- | move bot2 &`.
  It follows a point that is moved whilst they head for it. `pad` or `park` anyone idling on its route
  first, e.g. in a doorway, else they block it.
- **`pad` needs room.** In a crowded room it fails with `not padded: bot0`. `park` stands them against a wall instead.
- **Check a facing** with `w.n[key].rotation.y`. Towards a point `(dx, dz)` away it is `-(atan2(dz, dx) + π/2)`.

### Speech

- **`say` takes the npc last**: `say nominal as always bot1`. Otherwise a quoted first word is taken for the npc.
- **Escape an apostrophe**: `say captain\'s orders bot1`. An open quote leaves the tty at a `>` prompt,
  though `jsh` reports `exitCode: 0`. `interrupt` it.

## Recovering

Most edits hot-reload cleanly, and a reload resets the user's session (ttys, jobs, the paused World, the
view). So check with `query` what is actually stale before reaching for a reload, and patch it live if you can.

### What hot reload misses

| Changed | Picked up? | What to do |
|---|---|---|
| `current.gltf`, e.g. exported from Blockbench | No: nothing watches it, unlike the skin sheets (`skinSheetsRebuilt`) | Refetch `skins-and-gltf`: `window.__devMcp.getState().refetch(["skins-and-gltf"])` from a `query`, else ask the user to refetch it in the React Query devtools |
| A new clip in that glTF | Yes, on that refetch: every clip of the glTF is registered, even before its key in `fromAnimationClipKey` reaches the npc modules | Nothing more |
| `const.npc`, as the npcs' animation code reads it, e.g. `hitConfig` | Not always (see below) | Check with `query`, e.g. a hit's `anim.hurt.next`. If stale, swap the npcs onto a fresh class (below) |
| `service/player-frontier.ts` | The old `w.view.playerFrontier` instance is kept, so the World goes black (a NaN camera) | Rebuild it (below) |

Touching a file does not help: Vite sends no update for a file whose content is unchanged. So touching
`NPCs.tsx` does not bump its query key.

### Npcs on a stale `const.npc`

`NPCs.tsx`'s `devHotReload` is meant to cover this. On a hot update it swaps each npc and its `anim` onto the
`Npc` and `NpcAnimation` it imports, and fills in new fields. But on 2026-10-16 `npc-animation.ts` never
re-ran after `const.npc` changed. So that import was still the old class, and `hitConfig` stayed old even
after `NPCs.tsx` hot-updated.

Swap them onto a freshly imported class, which reads the latest `const.npc`. Their state is kept:

```js
async w => {
  const m = await import(`/@fs/<repo>/packages/ui/world/src/components/npc-animation.ts?t=${Date.now()}`);
  for (const n of Object.values(w.n)) Object.setPrototypeOf(n.anim, m.NpcAnimation.prototype);
}
```

Npcs spawned afterwards still get the class `NPCs.tsx` holds, so a reload is the full fix.

### A black World after editing `service/player-frontier.ts`

The camera is NaN: HMR keeps the old `w.view.playerFrontier` instance, but its callers now use the new shape.
A reload would not restore it, as `persistCamera` never saves a non-finite camera. Rebuild it live:

```js
async w => {
  const v = w.view, c = v.controls;
  const mod = await import(`/@fs/<repo>/packages/ui/world/src/service/player-frontier.ts?t=${Date.now()}`);
  v.playerFrontier = mod.createPlayerFrontier(() => v.playerLight, () => w.r3f?.invalidate());
  c.maxDistance = v.ctrlOpts.maxDistance; c.minDistance = v.ctrlOpts.minDistance; // NaN too
  v.resetCamera(); // turns the follow off: put it back
}
```

## Editing the MCP

| Edited | Then |
|---|---|
| `server.ts` or `cdp.ts` | Reconnect the server: `/mcp`, then `npc-cli`. |
| `dev-mcp-hooks.ts` | Usually nothing: it accepts its own hot update, so a save re-runs it in place, and the new store starts each tty's output counter (`since`) again. Check a new method is live with `typeof window.__devMcp.getState().<name>`: on 2026-10-16 `refetch` was not, and needed a reload. |
| `vite-plugin-dev-mcp.ts`, or anything else `vite.config.ts` loads | Restart the dev server, as Node keeps the old module. Then reload the page: after a restart its patched Vite client stays disconnected, so no HMR reaches it. |
