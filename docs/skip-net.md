# SkipNet

SkipNet is the intranet holding SCPs. As a panel, `packages/ui/skip-net` (uiKey `SkipNet`), it is a classic desktop aligned with one World (`meta.worldKey`, default `world-0`). It replaced the Scenario panel. A saved `Scenario` ui is read as a `SkipNet` (`renamedUiKeys` in `ui.store.ts`).

## Desktop

A dithered desk with a floating toolbar, icons and windows (`desktop/Desktop.tsx`), laid out by `react-grid-layout`.

- **Grid.** The desk is `desktopCols` (80) cells of `cellPx` (20px), wider than most panels, so it scrolls both ways. Its rows grow with the windows, `rowGapPx` (6px) apart, so windows one above another never touch.
- **No compaction.** Windows stay where they are put and overlap freely (`freeCompactor`). Upward, leftward and push-apart compaction were tried and dropped.
- **Show All Windows**, as macOS's Mission Control: every window is tiled within what is in view, shrunk to fit and never overlapping, in reading order (`showAllSlots`). A CSS transform on each moves it, so nothing remounts, and the desk dims and holds its scroll. It is toggled by the toolbar's ⊞ button, or a backtick whilst the pointer is over SkipNet and no text field has focus (`state.hovered`). A click on a window fronts it and ends it, as do a click on the desk and Escape. Each tile has its title in a badge at its centre, and a round close badge at its top-right whilst the pointer is over it (always on touch). Its bar's own boxes are hidden. It ends once the last window closes. Meanwhile nothing drags or resizes. A stacked panel has none.
- **Front window.** A press on a window stacks it over the rest (`bringToFront`, `restack` renumbers `z` from 1). Only the front window has pinstripes. Every window shows its close and windowshade boxes.
- **Saving.** A window's place is saved when a drag or resize ends (`saveLayout`), never during one. The grid's layout is memoised on geometry alone, so fronting a window leaves it be.
- **Desktop icons** sit at the top-right of what is in view, under every window (`DesktopIcons`): **files**, **chat**, and each World item mounted. A double-click opens one, as does a tap, but not a scroll (`tapSlopPx`).
- **The files folder** (`FolderWindow`) is a tree of the article folders (`articleFolders`), **video** then **npc**: name, when modified, and size (once wide enough). A click on a folder opens or closes it in place, saved as the window's `openFolders` (unset, all open). A click on an article opens it, fronting the window already showing it, else opening a new one. Sizes and dates come from `virtual:skip-net-articles` (`vite-plugin-skip-net-articles`): file times in DEV, last commit times in a build. The plugin is imported as a package, so editing it needs a dev server restart.

## Windows

`meta.windows` holds each window (`SkipNetWindow`). A new SkipNet opens the files folder and `npc-controls`, which a narrow panel stacks one above the other. Each window has its grid place `x`, `y`, `w`, `h`, its `z`, and what it shows (`SkipNetContent`). A `kind` is `folder`, `article`, `item` or `chat`. A saved `jobs` or `library` window is dropped: jobs are shown in their tty (`docs/jsh-jobs.md`), and the library's examples are articles.

- **Title bar.** It is the drag handle (`skip-net-drag`), with its windowshade and close boxes on the right (`skip-net-no-drag`). Every bar is 28px, or stacked on touch 48px. An article's title is a picker of every article. The close box shows an x, and a first press arms it red: a second within `confirmMs` closes the window.
- **Windowshade** rolls a window up to its bar, keeping its height in `shadedH`. Its box rolls it up. Rolled up, its box is greyed: a tap on its bar, not a drag, rolls it down. With a mouse, a double-click on its bar rolls it up or down instead, a single click only fronting it. A rolled-up bar overflows its one row, past the gap below.
- **Resizing.** A window resizes from any edge or corner. Only the bottom-right grow box is drawn, larger on touch. The rest are invisible strips (`desktop/desktop.css`).
- **Session picker.** An article window picks its tty in its title bar (`SessionPicker`, through `InTitle`), with a spinner whilst a run starts and "awaits {world}" whilst its World is not open.
- **Opening.** A new window is cascaded from the last opened (`newWindow`), sized by its kind. An article window is then fitted to its article once loaded (`fit`, `FitHeight`), between 6 rows and `articleRows`. Picking another article in its bar fits it again. In that picker each row starts with its doc or video icon, yellow if any of its commands autoruns (`docs/jsh-prelude.md`).
- **Sessions.** An article window runs in one session (`useWindowSession`). By default it is the first tty whose `WORLD_KEY` is SkipNet's World, else the first of all. Another may be picked, saved as the window's `sessionKey`. A picked session since removed gives way to the default.

## Toolbar

A small base-ui `Menubar` floating over the desk's top-right, above every window, so the desk takes the panel's full height (`desktop/Toolbar.tsx`). Stacked, it floats centred in the last window's bar, often folded, clear of its title and close box (`stackedClass`, sized to the bar). Windows are opened from the desktop icons, which sit below it.

- Show All Windows (`` ` ``, hidden whilst stacked)
- Clear, which asks first in a classic alert box (`ClearAlert`)
- **◆**, a menu portalled into SkipNet: the World's key

## Stack

A panel narrower than `stackPx` (640) shows its windows stacked instead (`desktop/Stack.tsx`, `state.narrow` from a `ResizeObserver`). Nothing about the desktop changes, so widening the panel restores it.

- Windows are in `stackOrder`, then any without one in the desktop's reading order, by `y` then `x` (`stackOrdered`). An article opened from another's picker (the popout icon on the right of its row) goes just beneath that window (`open`'s `below`). A move numbers every window's `stackOrder` (`moveInStack`), and the windows slide to their new places (motion's `layout="position"`, measured only on a move, `stack.moves`). Any other change eases a window's share instead, its contents in step: a fold or unfold eases to or from its bar, a window added grows from its bar, and one closed eases away (`easeFrame`, `easeOpen`, `close`). The desktop's places are untouched.
- A window is open unless windowshaded, so a fold in one layout is a fold in the other. Open windows share the height, the rest are bars.
- A tap on the front window's bar folds it, and a tap on any folded bar unfolds it, but not a drag (`clickSlopPx`). With a mouse it takes a double-click instead, on any bar. Every bar has its boxes. On touch, bars and boxes are finger-sized (`big` in `Window`).
- **Resizing.** A bar's grip (`data-stack-grip`: at its left, and on touch, unmarked, filling the bar between its title and picker too), dragged past `dragStartPx`, moves the boundary between the open windows either side of it. With a mouse, a window's bottom edge drags as the next bar's grip does (`data-stack-edge`), as the desktop's edges resize, each at least `stackMinPx` tall. Each open window's share is saved as `stackFlex`, apart from its desktop height. Until dragged, its share is its `h`. Whilst dragging, the bar is faintly tinted, after a short buzz on touch (`showDrag`). Dragged `foldPx` (40px) past a window's least height, the drag holds and two choices show, faded in, one above the other over the contents of the window it would fold, "move" further the way it was dragged (`choice`): dragged down, the bar's own window, up, the open window above. **collapse** folds it, dimmed whilst the finger is over it. **move up** or **down** moves the bar's own window the way it was dragged. "Collapse" is chosen by default, so letting go anywhere but over "move" collapses it. The choices lie ahead, the way it was dragged: dragging back `cancelPx` (24px) the other way dismisses them, and the drag resizes again. A bar with nothing open above it, e.g. the top window's, offers the same once dragged `foldPx` either way, for its own window. A bar whose window is last, dragged down, or first, dragged up, has nowhere to move: no choices show, it dims, and letting go collapses it (`isEdge`). The inverse unfolds a folded window to the finger: the window above, dragged down, or the bar's own, dragged up, taking room from the open window beyond, its contents mounted meanwhile (`unfoldingId`, `peek`). Let go under `foldPx` in, it stays folded (dimmed meanwhile). The fold and the shares are saved together (`setStackFlex`'s `unfoldId`).
- With no windows, the desktop icons show in a row.

## Light and dark

The chrome is greyscale, in `mac-*` colour tokens in `packages/app/src/styles/theme.css`: light (the classic white look) and `.theme-dark`. Window bodies keep their `term-*` colours. An article's `prose` is inverted only in the dark theme. SkipNet is light unless its tab's menu chooses otherwise (`defaultTheme: "light"`).

## Articles

An article is an mdx file in a folder, `src/articles/{folder}/{key}.mdx`, e.g. `npc/npc-spawn.mdx`. Its key is its name alone, so names are unique across folders. They replaced the jobs library and the blog, and may replace items.

- Each is a chunk of its own, loaded when first shown (`getArticle` in `articles.ts`). Folders follow `folderOrder`, and articles in each `articleOrder`. A stale `articleKey` gives way to the first (`articleKeyOf`).
- `@mdx-js/rollup` in `packages/app/vite.config.ts` compiles them with no highlighter, so their fences stay raw.
- `articleComponents` are in scope in each:
  - `pre` is `ShellFence`. An `sh` fence (or one with no language) is split into commands (`splitExamples` in `article/shell.ts`) and highlighted (`shell-highlight.ts`). Each shows only its comment, a larger run button on its left, copy and expand buttons on its right. Expand, or a click on the comment, shows its command beneath. One without a comment shows its command instead. Run runs it in the window's session (`useSessionRunner`). A fence resizes by its bottom-right corner, scrolling within, and its height is saved by fence id in `meta.fenceHeights`.
  - A fence's id is `{articleKey}#{hash of its source}` (`data-fence-id`), for amendments to attach to later.
  - `<Item itemKey="sidestep" />` shows a World item in place (`npc-sidestep`).
  - `<Video id="…" />` is a YouTube video loaded on click (`article/Video.tsx`, lazy, so its library loads only with it), e.g. `video/demo`.
  - `<SideNote>…</SideNote>` is an info icon in the text, showing the note on hover or press (a base-ui Popover with `openOnHover`, since a Tooltip ignores presses).
  - `mdx.d.ts` types these tags in the editor, as the global `MDXProvidedComponents` the MDX extension reads.
- Adding or renaming one reloads the page.

## Chat

A window of kind `chat` shows a giscus thread: GitHub Discussions in an iframe (`chat/ChatWindow.tsx`, `Comments.tsx` lazy, `giscus.config.ts`). Posting needs a GitHub sign-in.

- Its title bar picks the thread, saved as `threadKey`: `general`, or an article's key. Each is the discussion `skipnet/{threadKey}`.
- Whilst a window is dragged or resized, iframes take no pointer (`desktop.css`), else the chat would swallow the drag.

## Running commands

`use-session-runner.ts` runs an article's commands:

- It mounts the tty if it is not mounted (`markEverSeen`).
- It waits for the tty's profile to finish, saying which World the profile awaits.
- It runs the command as a background process (`sourceExternal`).
- A spinner shows until that process leads, read from the session's `process-leader` messages. A command already running is not run again.

## Items

An item is a component jsh mounts on the World: `w.skipNet.add({ key, title, Component })`, keyed, and `w.skipNet.remove(key)` (`use-world-skip-net.ts`, `JshCli.SkipNetItem`). A window of kind `item` shows one by its key (`ItemPane`). The desktop icons and File menu offer each one mounted (`useSkipNetItems`). An error in one shows in its place, cleared by a new item with its key.

- jsh `sidestep` mounts **sidestep** (`docs/sidestep.md`).
- A World remount loses them: re-run what mounted them.
