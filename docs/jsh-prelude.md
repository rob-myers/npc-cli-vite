# Jsh prelude

A World's **prelude** is jsh it runs before it first plays. It is a list of commands, each run in the background in its own tty, and switched by the **autorun** switch in the paused pill, on by default. It runs as the World loads. Both are kept per worldKey. The list starts empty, so nothing runs until a command is added.

## Marking a command

In a SkipNet article, a `# @bootable` line in a command's comment marks it bootable. The fence doesn't show that line.

```sh
# pointer moves player
# @bootable
pick meta.{floor,do} | move $( playerPath ) --force
```

A marked command has a toggle (a lightning bolt) on its right, before copy. On, it joins the prelude of its SkipNet's World (`meta.worldKey`), to run in the article window's tty. Entries run in the order they were toggled on.

An entry keeps a copy of its `src`. Its id is the example's (`{articleKey}#{fenceHash}/{index}`), so an edit of its fence turns its toggle off, but the entry stays until removed.

## Package

`packages/ui/jsh-prelude` (`@npc-cli/ui__jsh-prelude`):

| Export | What |
| --- | --- |
| `./store` | `preludeStore` (zustand, localStorage `jsh-prelude`): `byWorld[worldKey]` is `{ autorun, entries }`. `preludeApi`, `usePrelude` |
| `./run` | `runPrelude(worldKey)`: mounts each entry's tty if need be, awaits its profile, then runs it. A command already running is skipped. `rebootWorld` (below) |
| `./paused-pill` | `PausedPill`, the World's paused pill (below). Its row, `WorldPrelude`, is the switch, a button opening a modal of the entries, and reboot |
| `.` | The `JshPrelude` ui, a tab showing one World's (`meta.worldKey`) |

Only the app and SkipNet import it, SkipNet only `./store`. The World never does.

## The paused pill

The app forwards `PausedPill` into every World through `WorldPausedPillContext` (`ui/world/src/paused-pill.ts`), in `app/src/routes/index.tsx`. `WorldView` shows it in place of its own pill, handing it `resumeProps` to spread on its resume button: a tap resumes, and a pinch or wheel still reaches the camera.

- It says "loading" whilst the map changes, a spinner and "booting" whilst the prelude starts, else "paused". Only "paused" takes a tap.
- On load, if autorun is on, it runs the prelude. The World is paused, so its world commands start held by the World's pause group (`docs/jsh-pause.md`), and run on any unpause.
- Its chevron opens a row: the autorun switch, the list (a modal), and reboot.

## Reboot

`rebootWorld(worldKey, onStep)` in `run.ts` acts on each tty on the World (`WORLD_KEY`) running a process with the ptag `WORLD`. In three steps, each announced in the pill and in those ttys, a moment apart:

1. **killing jobs**: the foreground job (ctrl-c), and every job with a `WORLD` process.
2. **running profiles**: re-runs each one's profile (`ttyShell.runProfile`).
3. **running prelude**: `runPrelude`, if autorun is on.
