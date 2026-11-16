# SkipNet

SkipNet is the intranet holding SCPs. As a panel, `packages/ui/skip-net` (uiKey `SkipNet`), it is aligned with one World (`meta.worldKey`, default `world-0`), whose key its header shows. It replaced the Scenario panel. A saved `Scenario` ui is read as a `SkipNet` (`renamedUiKeys` in `ui.store.ts`).

## Panes

SkipNet lays out its own panes, saved in its meta (`meta.panes`). The layout is a tree: a split lays out its children one way, and a leaf is a pane.

- Its header's **jobs** adds a jobs pane and a library pane, unless there are some (`ensureJobs`). An empty pane takes each, else jobs goes above the library.
- Its header's **clear** leaves one empty pane, on a second press within 3s (`clearArmed`).

- The tree's functions are shared with the app's own layout (`paneTree` in `@npc-cli/util`, `service/pane-tree.ts`), each generic over what a leaf holds. A new node's id is one more than the tree's largest (`maxPaneId`).
- Each pane has a header:
  - a grip to drag it by
  - a picker of what it shows
  - split right and split down, which add an empty pane beside it
  - close. Closing the last pane leaves an empty one.
- **Drag to split.** A grip drags once moved `dragStartPx`. Near the middle of a pane's edge (`toEdge`), it shows where it would land: that half of the pane (`moveNode`). Over another pane's grip (`data-pane-grip`), that pane's header shows amber, and a drop swaps the two. Elsewhere nothing shows, and a drop does nothing. Dropped on its own edge, it moves to that side and an empty pane takes the rest. Escape cancels it (`onDragKey`). A pane joins its neighbour's split when that lies the same way (`splitNode`).
- Each split is an Allotment. Its sizes are saved once a sash is let go.
- A pane is remounted when it moves in the tree. What it keeps, it keeps in its leaf or in localStorage by `{uiId}:{paneId}`.

What a pane shows is its leaf (`SkipNetLeaf`): `kind` is `null` (empty), `library`, `jobs`, `article` or `item`. A library, jobs or article pane runs in one session (`usePaneSession`). By default it is the first tty whose `WORLD_KEY` is SkipNet's World, else the first of all. Another may be picked, saved as the leaf's `sessionKey`. A picked session since removed gives way to the default.

## Articles

An article is an mdx file, `src/articles/npc-*.mdx`, e.g. `npc-spawn`. They will replace the library and items.

- Each is a chunk of its own, loaded when first shown (`getArticle` in `articles.ts`). The picker lists them by key, in `articleOrder`. A stale `articleKey` gives way to the first.
- A second `@mdx-js/rollup` in `packages/app/vite.config.ts` compiles them without Shiki, so their fences stay raw.
- `articleComponents` are in scope in each:
  - `pre` is `ShellFence`. An `sh` fence (or one with no language) is split into commands as the library's are (`splitExamples`). A click runs one in the pane's session (`useSessionRunner`), and its left column copies it.
  - A fence's id is `{articleKey}#{hash of its source}` (`data-fence-id`), for amendments to attach to later.
  - `<Item itemKey="sidestep" />` shows a World item in place (`npc-sidestep`).
- Adding or renaming one reloads the page.

## Library

The jobs library (`library/JobsLibrary.tsx`), formerly in `Jobs`, whose examples are `library/examples/*.md` (`vite-plugin-jobs-examples`).

- `use-session-runner.ts` runs them, as `Jobs` once did:
  - It mounts the tty if it is not mounted (`markEverSeen`).
  - It waits for the tty's profile to finish, saying which World the profile awaits.
  - It runs the command as a background process (`sourceExternal`).
  - A spinner shows until that process leads, read from the session's `process-leader` messages. A command already running is not run again.

## Jobs

The process leaders of a session: the `Jobs` ui itself, imported lazily by subpath (`@npc-cli/ui__jobs/Jobs`), so it is also a ui of its own. Within SkipNet it is given the pane's session (`sessionKey`) and reports a pick (`onSessionKey`). On its own it keeps its first session. It connects by itself once its tty is mounted, e.g. by a library run, unless the user disconnected it (`optedOut`).

## Items

An item is a component jsh mounts on the World: `w.skipNet.add({ key, title, Component })`, keyed, and `w.skipNet.remove(key)` (`use-world-skip-net.ts`, `JshCli.SkipNetItem`). A pane of kind `item` shows one by its key (`ItemPane`), and the picker offers each one mounted (`useSkipNetItems`). An error in one shows in its place, cleared by a new item with its key.

- jsh `sidestep` mounts **sidestep** (`docs/sidestep.md`).
- A World remount loses them: re-run what mounted them.
