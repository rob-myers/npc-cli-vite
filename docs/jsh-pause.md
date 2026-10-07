# Pausing jsh processes

The ONLY doc for how jsh processes are paused and resumed: by the Jsh pane, by hand, and by the
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
- `api.isHeldOnlyBy(reason)` says whether one hold alone keeps it paused — see "Holds" below.
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
- A process paused by hand gets the hold `"manual"`: at once if already held, else when a reasoned STOP
  reaches it. Either way it stays paused until a plain CONT.

The reasons in use:

| reason | set by |
|---|---|
| `"jsh-pane"` | the Jsh pane's pause toggle, across its session: `sessionApi.kill(…, { byPtags: true })`, and processes spawned whilst it is paused |
| `"world"` | the World's pause group, below |
| `"manual"` | a process paused by hand, `kill --STOP {pid}` or its button in `<Jsh>`: whilst held, or before a hold reached it |

It is typed `HoldReason` (`session.ts`): `"jsh-pane"`, `"manual"`, else any string, i.e. a pause group's key.

## The `always` ptag

A process tagged `always: true` (`ProcessTag.always`) is only ever paused by hand: `killProcesses` skips it
for any STOP with a reason, so neither the Jsh pane nor any pause group holds it, and one spawned
whilst the pane is paused starts running. Unlike `setPausable`, which leaves one group, it leaves them all
— and stays out, where a plain CONT lasts only until the next pause.

- **A job**: `sessionApi.setAlways(sessionKey, pgid, always)` tags every process of it, as the tags
  popover of `<Jobs>` does (the row's ellipsis, which also lists the job's other ptags).
- **A process**: `ptags always` or `api.setPtags({ always: true })`, inherited by children spawned
  later; `ptags always=false` or `always=undefined` undoes it — only `true` counts, as with `WORLD_PAUSABLE`.
- Gaining it sheds every hold bar `"manual"` (`sessionApi.shedHolds`), so a job paused by the World
  resumes at once. Losing it pauses nothing until the next pause.
- Per process, so tag the whole job: in `pick | move` tagging `move` alone leaves `pick` to pause.

## The Jsh pane's pause

Pausing the pane (`<Tty disabled>`) does not pause the terminal: it suspends whatever is running at
that moment, and resuming the pane resumes exactly those. `Tty.pauseByPtags` STOPs every running
process, and only those: one already paused, e.g. by the World, is another's pause and is left be.
It remembers their pids, and `Tty.resumeByPtags` CONTs exactly those, all with the reason `"jsh-pane"`.
A process spawned whilst the pane is paused starts suspended, with the hold `"jsh-pane"` (`shell.ts`,
spawn).

## Pause groups

A pause group (`packages/cli/src/shell/pause-group.ts`) suspends and resumes whole jobs together,
with the reason `key`. A job (process group) is held as a whole as soon as any of its processes is a
member, i.e. tagged `pausablePtag(key)` — so a pipeline is never partly paused, as when you pause a
job yourself. The ptag is the key upper-cased with `_PAUSABLE`: the group `"world"` holds the jobs
tagged `WORLD_PAUSABLE`. The ptag says what a process is, the key (its hold) who paused it. Get one
with `api.pauseGroup(key)`:

- `pause()` holds every job with a live member. Processes started later aren't caught until the next `pause()`.
- `resume()` releases everyone it holds, member or not.
- `own(teardown)` registers teardowns for `dispose()`, e.g. unsubscribing whatever drives the group.
- There is one per session and key, kept in `session.pauseGroups`. A new one disposes the last, which
  resumes whatever it held; removing the session disposes them all.

The shell knows nothing of what drives a group; `jsh/world` does.

## Membership: ptags

A process's ptags are copied from its parent when it is spawned, so membership passes to all its
later descendants.

- **Default:** `modulePtags` in `packages/cli/src/jsh/modules.js` gives each module key default ptags.
  `Tty` hands it to the session store as `static.modulePtags` (`sessionApi.setModulePtags`): out of
  `/lib`, and the same for every session. Every module under `jsh/world/` gets `{ WORLD_PAUSABLE: true }`, found with
  `import.meta.glob`; dotted helpers such as `plan.main.ts` are excluded. The `run` builtin adds a
  module's defaults to its process, but only where a tag is absent.
- **Opting out:** `api.setPausable("world", false)`, i.e. the ptag `WORLD_PAUSABLE: false`, stops a
  process making its job a member, releasing any hold it had, and children spawned afterwards inherit
  `false`. An inherited `false` beats a module default, so an opted-out process's descendants stay out.
  A job keeps running only if none of its processes is a member: in `pick | move`, `move` makes the
  whole job pause, `pick` included.

Opted out today, because each must work whilst the World is paused (e.g. `phaser rob --raise`):

- `pick` (picking whilst paused),
- `events` (it reports the pause itself),
- `psi`, `phaser`, `give` and `drop` (each switches whilst paused) — `pose` pauses, though a kill still ends it,
- `spawn` (spawning whilst paused),
- `pause` and `play` (else `pause` would pause itself, and `play` start paused),
- `awaitWorld` (it sets up the group).

## The World's group

`awaitWorld` (`jsh/world/core.ts`), once the World is ready:

1. creates `api.pauseGroup("world")`, holding the jobs tagged `WORLD_PAUSABLE`,
2. subscribes to `w.events`: `disabled` calls `pause()`, `enabled` calls `resume()`,
3. pauses the group at once if the World is already paused.

So pausing the World suspends every job running a world command, and resuming releases only
what the World held. Anything the terminal or a user paused stays paused.

## Adding a long-running world command

- Support kill; see "jsh commands" in `docs/CLAUDE.md`.
- If it must keep going whilst the World is paused, call `api.setPausable("world", false)` first.
- Otherwise do nothing: it joins the World's group by default. It stops at its next read or write,
  and at any `isRunning()` check or `onSuspend` of its own.
- An `onSuspend` that stops an npc (e.g. `rejectAll`) should skip it whilst the World's is the only
  hold (`api.isHeldOnlyBy("world")`): the paused World holds them itself, and a move undone and redone
  on resume restarts the walk. Any other pause, e.g. by hand, stops them — it outlasts the World's.
  Use `handleNpcStatus` in `core.ts`, as `moveHandling` and `lookHandling` do.
