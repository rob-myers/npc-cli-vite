# Pausing jsh processes

The ONLY doc for how jsh processes are paused and resumed: by the terminal, by hand, and by the
World they drive.

## A process's status

Each process (`ProcessMeta` in `packages/cli/src/shell/session.ts`) is `Running`, `Suspended` or `Killed`.
Everything goes through `sessionApi.killProcesses`:

- **STOP** runs the process's `onSuspends`, then sets it `Suspended`.
- **CONT** runs its `onResumes`, then sets it `Running`.
- A callback returning `true` stays registered; any other is dropped once run.

Suspending doesn't interrupt a JS function by itself. The function blocks when it next reads or
writes (`preProcessRead`/`preProcessWrite` await `awaitResume`), or wherever it checks itself:

- `api.handleStatus({ onSuspend, onResume, cleanup })` registers callbacks, and returns `dispose()`.
- `api.isRunning()` and `api.awaitResume()` let a loop wait out a pause.
- `move` and `look` stop the npc on suspend and re-issue the move or look on resume — see
  `moveHandling` and `lookHandling` in `jsh/world/core.ts`.

## Holds: who paused it

Several things may pause a process, and none should undo another's pause. So a STOP or CONT may carry
a `reason` (`KillOpts.reason`), recorded in the process's `holds`:

- **STOP with a reason** adds the hold. Callbacks run only if it was the first hold.
- **CONT with a reason** removes that hold. The process resumes only once no holds remain, and only
  if it had that hold.
- **Plain STOP/CONT** (`kill --STOP`, `kill --CONT`, `api.pause()`, `api.resume()`, the Jobs UI) acts
  outright: a plain CONT clears every hold.
- A process paused outright *before* any hold gets the hold `"user"` when a reasoned STOP reaches it.
  It then stays paused until a plain CONT.

The reasons in use:

| reason | set by |
|---|---|
| `"tty"` | the `<Tty>` pausing: `sessionApi.kill(…, { byPtags: true })`, and processes spawned whilst it is paused |
| `"world"` | the World's pause group, below |
| `"user"` | a process paused outright before a hold reached it |

## The terminal's pause

When the Jsh pane is paused (`<Tty disabled>`), `Tty.pauseByPtags` STOPs every live process,
including ones already held by a group. It remembers their pids, and on resume CONTs
exactly those, all with the reason `"tty"`. A process spawned whilst the pane is paused starts
suspended, with the hold `"tty"` (`shell.ts`, spawn).

## Pause groups

A pause group (`packages/cli/src/shell/pause-group.ts`) suspends and resumes whole jobs together,
with the reason `key`. A job (process group) is held as a whole as soon as any of its processes is a
member, i.e. tagged `ptags[key] === true` — so a pipeline is never partly paused, as when you pause a
job yourself. Get one with `api.pauseGroup(key)`:

- `pause()` holds every job with a live member. Processes started later aren't caught until the next `pause()`.
- `resume()` releases everyone it holds, member or not.
- `own(teardown)` registers teardowns for `dispose()`, e.g. unsubscribing whatever drives the group.
- There is one per session and key. A new one disposes the last, which resumes whatever it held.

The shell knows nothing of what drives a group; `jsh/world` does.

## Membership: ptags

A process's ptags are copied from its parent when it is spawned, so membership passes to all its
later descendants.

- **Default:** `moduleTags` in `packages/cli/src/jsh/modules.js` gives each module key default ptags.
  Every module under `jsh/world/` gets `{ world: true }`, found with `import.meta.glob`; dotted helpers
  such as `plan.main.ts` are excluded. The `run` builtin adds a module's defaults to its process, but
  only where a tag is absent.
- **Opting out:** `api.setPtags({ world: false })` stops a process making its job a member, releasing
  any hold it had, and children spawned afterwards inherit `false`. An inherited `false` beats a module
  default, so an opted-out process's descendants stay out. A job keeps running only if none of its
  processes is a member: in `pick | move`, `move` makes the whole job pause, `pick` included.

Opted out today, because each must work whilst the World is paused (e.g. `pick | demo_psi`):

- `pick` (picking whilst paused),
- `events` (it reports the pause itself),
- `demo_psi` (switches on a pick),
- `spawn` (spawning whilst paused),
- `pause` and `play` (else `pause` would pause itself, and `play` start paused),
- `awaitWorld` (it sets up the group).

## The World's group

`awaitWorld` (`jsh/world/core.ts`), once the World is ready:

1. creates `api.pauseGroup("world")`,
2. subscribes to `w.events`: `disabled` calls `pause()`, `enabled` calls `resume()`,
3. pauses the group at once if the World is already paused.

So pausing the World suspends every job running a world command, and resuming releases only
what the World held. Anything the terminal or a user paused stays paused.

## Adding a long-running world command

- Support kill; see "jsh commands" in `docs/CLAUDE.md`.
- If it must keep going whilst the World is paused, call `api.setPtags({ world: false })` first.
- Otherwise do nothing: it joins the World's group by default. It stops at its next read or write,
  and at any `isRunning()` check or `onSuspend` of its own.
- An `onSuspend` that stops an npc (e.g. `rejectAll`) should skip it whilst `w.disabled`: the paused
  World already holds them, and a move undone and redone on resume restarts the walk — see
  `moveHandling` and `lookHandling` in `core.ts`.
