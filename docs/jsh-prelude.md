# Jsh prelude

A World's **prelude** is jsh it runs before it first plays. It is a list of commands, each run in the background in its own tty, and switched by the **auto-boot** switch in the paused pill, on by default. Both are kept per worldKey. The list starts empty, so nothing runs until a command is added.

## Marking a command

In a SkipNet article, a `# @bootable` line in a command's comment marks it bootable. The fence doesn't show that line.

```sh
# pointer moves player
# @bootable
pick meta.{floor,do} | move $( playerPath ) --force
```

A marked command has a toggle (a lightning bolt) beside its run button. On, it joins the prelude of its SkipNet's World (`meta.worldKey`), to run in the article window's tty. Entries run in the order they were toggled on.

An entry keeps a copy of its `src`. Its id is the example's (`{articleKey}#{fenceHash}/{index}`), so an edit of its fence turns its toggle off, but the entry stays until removed.

## Package

`packages/ui/jsh-prelude` (`@npc-cli/ui__jsh-prelude`):

| Export | What |
| --- | --- |
| `./store` | `preludeStore` (zustand, localStorage `jsh-prelude`): `byWorld[worldKey]` is `{ autoBoot, entries }`. `preludeApi`, `usePrelude` |
| `./run` | `runPrelude(worldKey)`: mounts each entry's tty if need be, awaits its profile, then runs it. A command already running is skipped |
| `./world` | `WorldPrelude`: the switch, and a button opening a modal of the entries |
| `.` | The `JshPrelude` ui, a tab showing one World's (`meta.worldKey`) |

Only the app and SkipNet import it, SkipNet only `./store`. The World never does.

## The first play

The app forwards `{ Ui: WorldPrelude, run: runPrelude }` into every World through `WorldPreludeContext` (`ui/world/src/prelude-slot.ts`), in `app/src/routes/index.tsx`.

- `w.played` is false until the World's first play since mounting. Until then `w.disabled` holds, whatever `meta.disabled` says.
- Any unpause (pill, Enter, menu, tab button, jsh `play`) clears `meta.disabled`, and `w.beginPlay` takes over (`w.firstPlay`).
  - It waits for the map to settle. The pill says "loading" meanwhile, and a press does nothing.
  - It awaits `run` for at most `preludeMaxMs` (3s), the pill spinning "booting". Commands still waiting on a tty run once it is ready.
  - Then it plays, unless paused meanwhile.
- `WorldPrelude` shows in the pill until the first play.
- A remount whilst playing plays at once, without the prelude.
