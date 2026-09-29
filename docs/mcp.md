# MCP server

The ONLY doc for the `npc-cli` MCP server, which lets Claude write npc behaviours against the running
app: try a line in a tty, keep what works as TypeScript, run it, and see what happened.

## Setup

- `pnpm dev` (port `DEV_PORT`, 5173).
- Claude Code starts the server from `.mcp.json` (`node --import=tsx scripts/src/mcp/server.ts`).
  `/mcp` shows it as `npc-cli`.
- On first use it attaches to a Chrome on CDP port `NPC_MCP_CDP_PORT` (9382), launching a visible one
  with its own profile if none is running, and opening the dev page there.

The page side is `packages/app/src/dev-mcp-hooks.ts`, a zustand store exposed as `window.__devMcp`: it
opens ttys, taps what is written to them, and projects world points to the screen. DEV only, and loaded
on first use (`window.__devMcpLoad`) once the World has a canvas, not at boot: it imports the shell, so
loading it early changes the order the app's own modules load in. That once broke the app — the shell's
`wasm_exec.js` stubbed a global `process` without `env`, which `polygon-clipping` read on load — and its
stub now has an `env`.

## Tools

| Tool | |
|---|---|
| `jsh({ cmd, tty?, waitMs?, typed? })` | Runs one line in `tty-1` (default), typed visibly unless `typed: false`. Returns when the prompt is back, else after `waitMs` (2000) with the command left running: `running: true` |
| `output({ tty?, since? })` | What the tty was written to since a previous result's `since` |
| `interrupt({ tty? })` | Ctrl-c: ends the foreground command so the tty takes input again |
| `query({ fn, world?, depth? })` | `fn` (JS source, e.g. `w => w.gms[0].rooms.length`) of the World as JSON, written to no tty |
| `click({ x, z, y? } \| { clientX, clientY }, long?, button? })` | A real pointer press, e.g. to answer `pick`. A world point is projected by the camera |
| `console({ since?, level? })` | The page's console and exceptions, e.g. an HMR error |
| `shot()` | A screenshot |

Each result ends with a status line, e.g. `{"running":false,"exitCode":0,"since":42}`.

A tty is opened as a tab beside `tty-0` the first time it is used. One busy with a foreground command
refuses a typed line: read it, or interrupt it. Run a long one as a background job (`… &`) to keep
the tty free; another tty (`tty-2`) is for when its output would bury the first's. Each tty has its own `~` (`/home`) — data
two of them share goes in `/shared`.

## Working

1. Prototype in a tty: pipelines, `map`, `w n.rob.anim.fast`.
2. Keep what is reusable as an exported function of a `packages/cli/src/jsh/world/*_mcp.ts` module
   (`demo_mcp.ts` first), written like the commands in `core.ts`. A new module is added to `modules.js`
   and the profile's `source /etc/{…}.js.sh`.
3. Check it loaded: `jsh({ cmd: "declare -F" })`, or `console` for an error.
4. Run it, interactively if need be: e.g. `jsh({ cmd: "events 'e => e.key === \"enter-collider\"' | foo &" })`,
   then `jsh({ cmd: "move rob to:[…]" })`, then `output()`.

World queries beyond a line of `w` are JS functions too, e.g. in a `debug_mcp.ts`, reading the World
from `ct.w` and returning plain data.

## Conventions

- **The tty is shared**: the user watches it. Keep lines short and typed (`typed: true`), e.g. `npcs`,
  `move …`, `say …`. Read bulk or exploratory state with `query`, never a long `w '…'` that floods it.
- **Fade-rooms mode follows the session's aim**: `sight` when imagining what the player sees; `sense`
  or `ship` are fine otherwise, e.g. debugging many npcs (`w view.setFadeRoomsMode ship`). In `sight` an
  unlit room cannot be picked, so a `click` there does nothing useful.
- **View settings persist**: `w view.setFollowMode loose` and the fade mode are saved, so put back what
  a session changed unless asked to keep it.
- **`click` a world point only when it is on-screen**: else point the camera there first
  (`w view.lookAt '{ x, y }'`, with follow `off` or it pulls back to the player).
- **To show the player, use `w view.holdFrontier`**: the look button's short press, framing them and
  their frontier. `w view.onLookGesture false` is the press itself, but stops a follow instead of looking.
- **The World is often paused**, e.g. after a reload: a `move` then waits, and just after load `npcs`
  may print `[]`. Unpause it with `query` `w => w.setDisabled(false)`.
- **To switch tabs, type a line there**: a typed line brings its tty to the front.

## Recipes

- **Into a bed without `pick`**: pipe the decor point itself, which carries `meta.do`:
  `w 'w => w.decor.byKey["g0r3-point-0_76-0_51-11_09"]' | move npc:rob`. Find keys with `query` over
  `w.decor.byRoom`. `w.decor.runtime.byKey` holds runtime decor only, not a map's own. The shell drops
  piped `undefined`, so a wrong key pipes nothing and exits `0`: check it with `query` first.
- **Picking a bed** gives its obstacle's meta (`decorIds`), and `move` takes the first free point of it.
- **A free bed in a room**: `w.gms[gmId].obstacles` meta has its kind (`bed`, `chair`), `roomId` and
  `decorIds`; a point is taken iff `w.e.doableToNpc[w.gms[gmId].decor[id].key]`. `w.decor.byRoom` and
  `w.decor.grid` index decor too.
- **A room's centre may be off the navmesh**, e.g. under an obstacle: `move` fails `not navigable`.
  Place away from a room's obstacles, read from `w.gms[gmId].obstacles` by `meta.roomId`.
- **Spawn with a skin, then look**: `spawn npc:bot0 at:[14.5,0,5] skin:robot-0`, then
  `look bot0 at:rob; look bot1 at:rob` — `;` chains lines.
- **`say` takes the npc last**: `say nominal as always bot1`, else a quoted first word is taken for the npc.
  Escape an apostrophe, `say captain\'s orders bot1`: an open quote leaves the tty at a `>` prompt,
  though `jsh` reports `exitCode: 0` — `interrupt` it.
- **Points go in decor, not the command**, so they can be dragged in the Decorator:
  `decor to:[15.75,7.75] key:patrol-bot2-0`, then read them back by key prefix with `route patrol-bot2-`.
- **A patrol is a background job**, so the tty stays free: `patrol_route bot2 patrol-bot2- | move bot2 &`.
  It follows a point moved whilst they head for it. `pad` or `park` those idling on its route first,
  e.g. out of a doorway, else they block it.
- **`pad` needs room**: in a crowded room it fails `not padded: bot0`; `park` stands them against a wall instead.
- **Check a facing** by `w.n[key].rotation.y`, which is `-(atan2(dz, dx) + π/2)` towards a point `(dx, dz)` away.

## Seeing Claude's calls

The VS Code extension shows an MCP call's result (OUT) but not its input (IN). The session transcript
has both — follow it with:

```sh
tail -f ~/.claude/projects/-Users-robmyers-coding-npc-cli-vite/<session-id>.jsonl | jq -c --unbuffered \
  'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and (.name|startswith("mcp__npc-cli"))) | {name: (.name|sub("mcp__npc-cli__";"")), input}'
```

The Claude Code CLI shows the input inline, and `claude --resume` opens the same session there.

## Editing the MCP

- `server.ts` or `cdp.ts`: reconnect the server (`/mcp`, then `npc-cli`).
- `dev-mcp-hooks.ts`: saving it reloads the page, so the World restarts and each tty's output counter
  (`since`) starts again.

