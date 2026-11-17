# SkipNet

SkipNet is the intranet holding SCPs. As a panel, `packages/ui/skip-net` (uiKey `SkipNet`), it is a classic desktop aligned with one World (`meta.worldKey`, default `world-0`). It replaced the Scenario panel. A saved `Scenario` ui is read as a `SkipNet` (`renamedUiKeys` in `ui.store.ts`).

## Desktop

A dithered desk with a menu bar, icons and windows (`desktop/Desktop.tsx`), laid out by `react-grid-layout`.

- **Grid.** The desk is `desktopCols` (80) cells of `cellPx` (20px), wider than most panels, so it scrolls both ways. Its rows grow with the windows.
- **Arranging.** In `meta.arrange` `free` (the default), nothing compacts (`getCompactor(null, true)`), so windows overlap. In `tidy` they compact upwards (`verticalCompactor`). **Clean Up** compacts them once.
- **Front window.** A press on a window stacks it over the rest (`bringToFront`, `restack` renumbers `z` from 1). Only the front window has pinstripes and its boxes.
- **Saving.** A window's place is saved when a drag or resize ends (`saveLayout`), never during one. The grid's layout is memoised on geometry alone, so fronting a window leaves it be.
- **Desktop icons** sit at the top-right of what is in view, under every window (`DesktopIcons`): **npc**, **library**, and each World item mounted. A double-click opens one, as does a tap, but not a scroll (`tapSlopPx`).
- **The npc folder** (`FolderWindow`) lists its articles as files: name, when modified, and size (once wide enough). A click opens one, fronting the window already showing it, else opening a new one. Sizes and dates come from `virtual:skip-net-articles` (`vite-plugin-skip-net-articles`): file times in DEV, last commit times in a build.

## Windows

`meta.windows` holds each window (`SkipNetWindow`): its grid place `x`, `y`, `w`, `h`, its `z`, and what it shows (`SkipNetContent`). A `kind` is `folder`, `article`, `library` or `item`. A saved `jobs` window is dropped: jobs are shown in their tty (`docs/jsh-jobs.md`).

- **Title bar.** It is the drag handle (`skip-net-drag`), with a close box on the left and a windowshade box on the right (`skip-net-no-drag`).
- **Windowshade** rolls a window up to its bar, keeping its height in `shadedH`.
- **Grow box.** A window resizes from its bottom-right corner, larger on touch.
- **Info bar.** Under the title, double-ruled (`infoBarClass`): "N items" in the folder, else the window's session (`SessionBar`).
- **Opening.** A new window is cascaded from the last opened (`newWindow`).
- **Sessions.** An article or library window runs in one session (`useWindowSession`). By default it is the first tty whose `WORLD_KEY` is SkipNet's World, else the first of all. Another may be picked, saved as the window's `sessionKey`. A picked session since removed gives way to the default.

## Menu bar

Base-ui `Menubar` menus, portalled into SkipNet (`desktop/MenuBar.tsx`):

- **◆**: the World's key
- **File**: open the npc folder, a new library window, open each World item, close the front window
- **View**: Clean Up, Free or Tidy
- **Special**: Clear Desktop…, which asks first in a classic alert box (`ClearAlert`)

## Stack

A panel narrower than `stackPx` (640) shows its windows stacked instead (`desktop/Stack.tsx`, `state.narrow` from a `ResizeObserver`). Nothing about the desktop changes, so widening the panel restores it.

- Windows are in `stackOrder`, then any without one in the desktop's reading order, by `y` then `x` (`stackOrdered`). Each bar's up and down boxes swap it with its neighbour (`moveInStack`), which numbers every window's `stackOrder`. The desktop's places are untouched.
- A window is open unless windowshaded, so a fold in one layout is a fold in the other. Open windows share the height, the rest are bars.
- A tap on a bar folds or unfolds it. Every bar has its boxes.
- **Resizing.** A bar dragged (`dragStartPx`) moves the boundary between the open windows either side of it, each at least `stackMinPx` tall. Each open window's share is saved as `stackFlex`, apart from its desktop height. Until dragged, its share is its `h`.
- With no windows, the desktop icons show in a row.

## Light and dark

The chrome is greyscale, in `mac-*` colour tokens in `packages/app/src/styles/theme.css`: light (the classic white look) and `.theme-dark`. Window bodies keep their `term-*` colours. An article's `prose` is inverted only in the dark theme.

## Articles

An article is an mdx file, `src/articles/npc-*.mdx`, e.g. `npc-spawn`. They will replace the library and items.

- Each is a chunk of its own, loaded when first shown (`getArticle` in `articles.ts`). The folder lists them in `articleOrder`. A stale `articleKey` gives way to the first.
- A second `@mdx-js/rollup` in `packages/app/vite.config.ts` compiles them without Shiki, so their fences stay raw.
- `articleComponents` are in scope in each:
  - `pre` is `ShellFence`. An `sh` fence (or one with no language) is split into commands as the library's are (`splitExamples`). A click runs one in the window's session (`useSessionRunner`), and its left column copies it.
  - A fence's id is `{articleKey}#{hash of its source}` (`data-fence-id`), for amendments to attach to later.
  - `<Item itemKey="sidestep" />` shows a World item in place (`npc-sidestep`).
- Adding or renaming one reloads the page.

## Library

The jobs library (`library/JobsLibrary.tsx`), whose examples are `library/examples/*.md` (`vite-plugin-jobs-examples`).

- `use-session-runner.ts` runs them:
  - It mounts the tty if it is not mounted (`markEverSeen`).
  - It waits for the tty's profile to finish, saying which World the profile awaits.
  - It runs the command as a background process (`sourceExternal`).
  - A spinner shows until that process leads, read from the session's `process-leader` messages. A command already running is not run again.

## Items

An item is a component jsh mounts on the World: `w.skipNet.add({ key, title, Component })`, keyed, and `w.skipNet.remove(key)` (`use-world-skip-net.ts`, `JshCli.SkipNetItem`). A window of kind `item` shows one by its key (`ItemPane`). The desktop icons and File menu offer each one mounted (`useSkipNetItems`). An error in one shows in its place, cleared by a new item with its key.

- jsh `sidestep` mounts **sidestep** (`docs/sidestep.md`).
- A World remount loses them: re-run what mounted them.
