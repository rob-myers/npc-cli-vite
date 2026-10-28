# Tasks

The ONLY doc for `Task` (`packages/util/src/service/task.ts`, from `@npc-cli/util`): async code that a jsh kill,
or anything else, can end at once. Usually a command's wait on the World, sometimes World code.

## Why

A jsh command that awaits World code must end on ctrl-c (see "A long-running command must support kill" in
`CLAUDE.md`). The command itself can stop waiting by racing a `killed` promise. The World code it started
keeps going unless it can be told to stop. A `Task` is how it is told. A `Task` in the command also waits on
World state (`until`) and counts time (`wait`) as only a kill can end.

## The class

- `new Task(isPaused?, nowMs?)`: time waited on counts only whilst not `isPaused()`, e.g. `() => w.disabled`, so a paused
  World runs no timeout down. `nowMs` is the clock, by default real time. Pass game time
  (`() => 1000 * w.gameTime.now()`) for a timeout that slows with the game.
- `cancel()` ends it. `isCancelled` says whether it has been.
- `wait(promise?, ms?)` resolves with `promise`, or after `ms`, whichever is first. It rejects once the task is
  cancelled. With neither, it waits until then.
- `until(done, ms, stepMs = 50)` resolves once `done()` is true, or after `ms`, checking every `stepMs`.
- `run(steps)` runs async `steps`. A cancel ends them quietly. Any other error is thrown.

Every await inside `steps` goes through `wait` or `until`, so code after a cancel never runs.

## The pattern

**The command keeps the task** when the World only holds state, which its own tick changes. The command makes
the task, its kill cleanup cancels it, and it waits with `until`:

```ts
w.phasers.aimAt(npcKey, at);
const aimed = w.phasers.arms.get(npcKey)?.aimAt;
const task = new Task();
const handlers = api.handleStatus({ cleanup: () => task.cancel() });
try {
  await task.run(() => task.until(() => w.phasers.arms.get(npcKey)?.aimAt !== aimed));
} finally {
  handlers.dispose();
}
if (task.isCancelled === true) throw api.getKillError(); // after letting go of what it started
```

`aimAtPart` (jsh `phaser kate at:rob`), `wSleep` in `core.ts` and `act` in `act.ts` are examples. A paused World
ticks nothing, so the state does not change and the wait goes on.

**The World code keeps the task** only when it runs async steps of its own, which a kill must stop. Its owner makes
the task on starting, cancels it on every way out in one place, and runs as `await task.run(async () => { ... })`. A
command calls it, and its kill cleanup calls the owner's `cancel()`. None does so at present.

## Where it is not used

The npc's own promises (`npc.look`, `npc.move`, `npc.resolve`, `npc.reject` in `npc.ts` and `npc-animation.ts`)
have their own way to end, and stay as they are. A `Task` can still wait on one, e.g. `task.wait(npc.look(…))`.

Use a `Task` for new World code that a command awaits and that is more than one npc promise: several waits
in turn, polling, or a UI left open until the user chooses.
