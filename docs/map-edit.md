# MapEdit saving

Everything about where a MapEdit file goes when you save it. Nothing about it lives in another doc.

| file | what it holds |
|---|---|
| `ui/map-edit/src/MapEdit.tsx` | `save`, `load`, `discardDraft`, `deleteFile`, `updateSavedFileSpecifiers`, the mutations |
| `ui/map-edit/src/map-node-api.ts` | `LOCAL_STORAGE_PREFIX`, `getFileSpecifierLocalStorageKey`, `getLocalStorageFileSpecs` |
| `ui/map-edit/src/editor.schema.ts` | `MapEditSavedFileSchema`, `isPlaygroundSymbolKey`, `isPlaygroundMapKey` |
| `scripts/src/service/process-map-edit-save.ts` | `saveMapEditFile` — the DEV-only filesystem write |

## Two stores

A file lives in one of two places, never both for long:

- **the filesystem**, `packages/app/public/{symbol,map}/<filename>.json`, committed, and the only
  thing production ever serves;
- **a localStorage draft**, under `map-edit:<type>:<filename>` (`getFileSpecifierLocalStorageKey`),
  per browser.

`load` prefers the draft and falls back to fetching the file, unless called with `ignoreDraft`. What
it reads is run through `migrateMapEditSavedFile` and then `MapEditSavedFileSchema`, so a draft left
by an older shape is either migrated or discarded with a warning rather than crashing the editor.

## Who may save

Two gates, both in `MapEdit.tsx`:

- `isLocked()` — a touch device, or `devForceReadOnly` in DEV. Nothing saves or deletes.
- `isReadOnly(file)` — `isLocked()`, **or** production on a file that is not a playground file.

So in production only playground files are editable, and their edits only ever reach localStorage.

## Where a save goes

`save(fileSpecifier)` builds a `MapEditSavedFile` — the specifier, `width`/`height`, `nodes`, and
`bounds` taken from the underlay image node when there is one, else the union of every node with the
svg rect — then:

| file | env | goes to |
|---|---|---|
| playground | either | localStorage only, toast `draft saved` |
| other | DEV | `POST /api/map-edit/file/:type/:filename`, toast `saved to file`, **stale draft removed** |
| other | DEV, dirty-exit autosave | localStorage only (`autoSaveDraftOnDirtyExit`), no POST |
| other | PROD | nothing — `isReadOnly` returns early |

A playground save also dispatches `mapEditSymbolSavedEvent` on `window`, which `World` listens for
to recompute its layouts from the drafts.

The filesystem is canonical for non-playground files, which is why a successful DEV save deletes any
draft for that file: leaving one would silently shadow the file it just wrote.

## The DEV server side

`saveMapEditFile(filePath, body)` in `scripts/src/service/process-map-edit-save.ts`, in order:

1. `parseRawMapEditFile(body)` — parse and validate; a bad body never reaches the disk;
2. write the JSON;
3. `createSavedFileThumbnail` — a skia-canvas render to `<filename>.thumbnail.png` beside it;
4. `ensureManifests` for `symbol` and `map`, passing the changed file.

`DELETE` on the same route removes the file, and `deleteFile` (DEV only) removes the draft, calls it,
and loads some other file if the deleted one was current.

Both are React Query mutations whose `onSuccess` invalidates `["map-edit-manifests"]`. They inherit
`networkMode: "always"` in DEV from `QueryClientApi` — without it an offline browser *pauses* the
mutation rather than failing it, and the write hangs until connectivity returns.

## The file selector

`savedFileSpecifiers` is the source of truth for `MapFileSelect` in `FileMenu.tsx`, rebuilt by
`updateSavedFileSpecifiers(drafts)` from the two manifests plus the localStorage drafts. **Always
produce a new array** — mutating in place and passing the same reference stops `useMemo` recomputing
`mapFiles`. Only maps have a trash button; symbols are not deletable from the UI.

## Getting back to the committed definition

`discardDraft(file)` removes the localStorage key, rebuilds `savedFileSpecifiers`, and reloads with
`ignoreDraft: true`. In production that is the only way back — your edits never touched the file.

## Playground files

A file is a playground file when its key ends `--playground` (symbol) or `-playground` (map). That
suffix is the whole test — see `isPlaygroundSymbolKey` / `isPlaygroundMapKey`. It is what makes a
file editable in production, and `DerivedGmsData` skips playground symbols when keying geomorph data
by number.

**`g-301--playground` was constructed by hand.** Unlike the core geomorphs, whose hull and doors come
out of the starship symbol pipeline, we drew its structure ourselves in MapEdit and committed the
result as `packages/app/public/symbol/g-301--playground.json`. It holds:

- an `image` node for the underlay, `g-301--playground.png`, from
  `packages/media/src/starship-symbol/playground/`;
- a `hull` group — paths named `wall hull`, one `window hull y=1.1 h=0.6 curved`, one
  `wall hull sans-n--20x10`;
- a `doors` group — rects named `door hull edge=s|w|e slide=[…]`, each paired with a
  `decor quad key=switch` image.

The node **names are the tags**: `wall hull` is what makes a path a hull wall, `door hull edge=s` is
what makes a rect a hull door. Nothing else marks them. It is registered in `symbolByGroup.playground`
in `packages/media/src/starship-symbol/const.ts`, where a comment notes that every playground symbol
is assumed to be a hull symbol.
