# Tasks

The ONLY doc for `Task` (`packages/util/src/service/task.ts`, from `@npc-cli/util`): async World code that a
jsh kill, or anything else, can end at once.

## Why

A jsh command that awaits World code must end on ctrl-c (see "A long-running command must support kill" in
`CLAUDE.md`). The command itself can stop waiting by racing a `killed` promise. The World code it started
keeps going unless it can be told to stop. A `Task` is how it is told.

## The class

- `new Task(isPaused?)`: time waited on counts only whilst not `isPaused()`, e.g. `() => w.disabled`, so a paused
  World runs no timeout down.
- `cancel()` ends it. `isCancelled` says whether it has been.
- `wait(promise?, ms?)` resolves with `promise`, or after `ms`, whichever is first. It rejects once the task is
  cancelled. With neither, it waits until then.
- `until(done, ms, stepMs = 50)` resolves once `done()` is true, or after `ms`, checking every `stepMs`.
- `run(steps)` runs async `steps`. A cancel ends them quietly. Any other error is thrown.

Every await inside `steps` goes through `wait` or `until`, so code after a cancel never runs.

## The pattern

The owner of the World state keeps the task in its state:

1. Its start makes the task, e.g. `state.task = new Task()`.
2. Its every way out cancels it and clears the field, in one place.
3. Its async method runs as `await task.run(async () => { ... })`. To stay pending until the thing is over,
   the last step is `await task.wait()`.
4. Its `cancel()` ends the thing as a user would, e.g. Escape, and so cancels the task.

The jsh command then calls the method, and its kill cleanup calls `cancel()`:

```ts
const handlers = api.handleStatus({ cleanup: () => (w.npcFocus.cancel(), onKill()) });
try {
  await Promise.race([w.npcFocus.aimAt(key), killed]);
} finally {
  handlers.dispose();
}
```

`NpcFocus` (`begin`, `abandon`, `aimAt`, `cancel`) and jsh `focus` in `core.ts` are the example.

## Where it is not used

The npc's own promises (`npc.look`, `npc.move`, `npc.resolve`, `npc.reject` in `npc.ts` and `npc-animation.ts`)
have their own way to end, and stay as they are. A `Task` can still wait on one, e.g. `task.wait(npc.look(…))`.

Use a `Task` for new World code that a command awaits and that is more than one npc promise: several waits
in turn, polling, or a UI left open until the user chooses.
