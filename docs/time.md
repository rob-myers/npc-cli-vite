# Time

The ONLY doc for the World's clocks: game time, which the time scale slows or speeds, and real time, which it never touches.

## Two clocks

Both are in `packages/ui/world/src/service/clock.ts`.

| Clock | What | Runs on it |
| --- | --- | --- |
| `w.gameTime` | A `GameTime`: three-stdlib's `Timer`, scaled by `scale` | Behaviours, animations, timers, detection |
| `w.realTime` | `now()` (seconds since page load) and `node` (TSL's `time`) | The camera, UI marks, the World fold |

- `w.gameTime.now()` is game seconds so far. `w.gameTime.delta()` is the game seconds in the last tick.
- Only `World.onTick` advances game time (`update`). A paused World runs no tick, so a pause holds game time.
- On resume, `reset` starts the next tick's delta from then.

## What runs on game time

`World.onTick` passes the game delta to the doors, the net mirrors, the npcs (crowd, `anim.tick`, the mixer), speech and bubbles. `postNpcTick` then runs everything that draws on the npcs.

- **Detection** follows for free. The physics worker steps on the npc positions each tick sends.
- **Phasers**, shields and npc shields read `w.gameTime`.

## What runs on real time

- `view.followPlayer` takes a real delta, so a slowed World never makes the camera sluggish.
- `foldTo` (the World folding flat on a map change).
- `NpcRings`, whose morphs run on TSL's `time`. They fade whilst paused too.
- r3f's own `useFrame` delta, e.g. `LightSweep`'s frontier easing.
- Targeting's casts along a raised phaser, and its aim dot (`NpcFocus`): they follow the aim, not a clock.

## The time scale

`w.gameTime.scale` is game seconds per real second, `0` to `2`.

- `w.gameTime.setScale(s)` clamps it, sets the Timer's timescale, and saves it in the world store (`timeScale`), so it survives a reload.
- The menu's vertical slider sits below its first three buttons. Its bottom half is logarithmic from 1/32 up to `1`, so small scales have room, and its top half linear up to `2`. Its bottom is `0`.
- jsh `timescale` prints it, or sets it first: `timescale 0.25`.
- Scale `0` freezes the game, but not the frame loop. The camera still moves, and jsh still runs. Pausing is different: it stops the World's tick, and the World's pause group suspends world commands (`docs/jsh-pause.md`).
- On a net client the slider is disabled. The scale is not synced from the host.

## Waiting in game time

Never `setTimeout` for game behaviour: it runs on in real time, and through a pause.

- `w.e.after(secs, fn)` runs `fn` after `secs` of game time and returns a cancel. Its timers are checked after each npc tick.
- `w.e.wait(secs)` is the same as a promise.
- A `Task` counts game time given `() => 1000 * w.gameTime.now()` as its clock (`docs/tasks.md`).
- In jsh, `wSleep` (`core.ts`) sleeps game seconds. Like `api.sleep`, it stops counting whilst its process is suspended, and a kill ends it. It is a command too: `wSleep 2`.
- `api.sleep` stays real time. Use it for input cadence, e.g. `wasd_delta`'s interval, and polling.

## Adding something timed

- If it is part of the game, read `w.gameTime`, or wait with `w.e.after` / `w.e.wait` / `wSleep`.
- If the player steers it or sees through it, read `w.realTime`.
- An r3f `useFrame` delta is real time. Scale it by `w.gameTime.scale` if it drives the game.
