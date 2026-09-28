# Deploys and stale tabs

Everything about a tab outliving its deploy. Nothing about it lives in another doc.

A phone keeps a backgrounded tab for days, so it can be several deploys old when it next opens a
lazy ui. That fails with `Failed to fetch dynamically imported module` unless its build's chunk is
still on the site, and the site keeps it only if nothing renamed it needlessly.

| file | what it holds |
|---|---|
| `scripts/src/vite-plugin-build-id.ts` | `buildIdPlugin` — `<meta name="build-id">` in `index.html`, `/version.json` |
| `packages/app/src/components/NewVersionToast.tsx` | the "New version available" toast |
| `packages/ui-sdk/src/StaleSiteNotice.tsx` | what a ui shows when its chunk won't load |
| `packages/util/src/service/build-info.ts` | `getBuildInfo`, `fetchLatestBuild`, `simulatedStaleUi` |
| `scripts/src/vite-plugin-asset-history.ts` | `assetHistoryPlugin` — carries old assets forward, `/asset-history.json` |
| `scripts/src/vite-plugin-stable-entry.ts` | `stableEntryPlugin` — keeps chunks from importing the entry |
| `packages/ui-registry/src/ui-schemas.ts` | `uiSchemas` — each ui's schema, without its lazy component |
| `packages/app/netlify/functions/asset-not-found.mts` | the uncached 404 for a missing asset |
| `packages/app/public/_headers`, `_redirects` | caching, and the fallback for a missing asset |

## Telling a tab it is stale

`buildIdPlugin` writes the build's id and time into `index.html` (`<meta name="build-id">`,
`"build-at"`) and `/version.json` (`{ id, at }`). `NewVersionToast` compares them on
`visibilitychange`, `pageshow` and `vite:preloadError`, at most once a minute, and offers a reload.
In dev it is off unless the url has `?checkVersion`; `showNewVersion()` in the console forces it.

The id lives in the html, never in a `define`: a `define` inlines it into a hashed chunk, which
renamed 15 chunks on every build, even one that changed nothing.

## A ui whose chunk won't load

Opening a ui whose chunk a later deploy removed throws `Failed to fetch dynamically imported
module`. `UiErrorBoundary` recognises it (`chunkLoadFailureRegex`) and shows `StaleSiteNotice`,
which fetches the latest build and says which case it is:

- a newer build: "This page is out of date", with this page's build time, the latest's, and the gap;
- the same build: the network probably failed;
- no answer: the site is unreachable.

It shows in dev too; "Technical details" still has the error and stack, and "Reload page" fixes it.

**To see it**, add `?simulateStale=<uiKey>` to the url (dev or prod) and open that ui, e.g.
`?simulateStale=MapEdit` then the `mapedit-0` tab. `UiPortalContainer` throws the same error in its
place, and `fetchLatestBuild` pretends a build from now exists.

**To test the real thing**, act out a deploy under an open page:

```bash
pnpm build && pnpm preview        # open it, leave the mapedit-0 tab unopened
rm packages/app/dist/assets/MapEdit-*.js
node -e "require('fs').writeFileSync('packages/app/dist/version.json', JSON.stringify({ id: 'newer', at: new Date().toISOString() }))"
# now open mapedit-0: its chunk 404s
```

## Caching

`/assets/*` is hashed, so `immutable` for a year. Everything else in `public/` (`assets.json`,
`sheets.json`, `sheet/*`, ...) is unhashed, so `max-age=0, must-revalidate`: a 304 when unchanged,
but never new code paired with old data. `sheets.json` and `sheet/*` are keyed by index, so a
stale pair gives wrong uvs rather than an error.

## Keeping old assets

During a production build the live site still serves the previous deploy, so it is the archive.
`assetHistoryPlugin` fetches its `/asset-history.json`, downloads the hashed assets this build no
longer emits into `dist/assets`, and writes a new history. Old chunks are then ordinary static
files on the same origin: an old tab loads them without a reload, and "Clear cache and deploy"
cannot lose them.

- A superseded asset is dropped once 30 deploys have passed since a build last produced it. Only
  a build drops anything, so without deploys nothing leaves.
- Production only (`CONTEXT=production`). `ASSET_HISTORY_FROM=<url>` points it at any site, e.g. a
  `vite preview` of an earlier build.
- It never fails a deploy: if the history cannot be fetched it warns and carries nothing.
- It keeps code, not data. An old tab reads the new `assets.json` and `sheets.json`, which is what
  the toast is for.

`/asset-history.json` also logs each retained deploy's ui entry chunks and sizes:

```json
"deploys": [{ "seq": 7, "commit": "187ff7e3", "at": 1790…,
  "ui": { "MapEdit": "assets/MapEdit-Ci5ob05m.js", … },
  "counts": { "current": 70, "added": 3, "carried": 3 },
  "bytes": { "current": 10705369, "added": 152222, "carried": 152194 } }]
```

`current` is the build's own assets, `added` those new to the site (the growth), `carried` the
older ones kept. The build log prints the same. A MapEdit change adds about 0.1MB.

Diff two consecutive entries to see which ui urls a deploy changed:

```bash
curl -s https://npc-cli-vite.netlify.app/asset-history.json | python3 -c "
import json,sys; d=json.load(sys.stdin)['deploys'][-2:]
print({k:(d[0]['ui'].get(k),v) for k,v in d[-1]['ui'].items() if d[0]['ui'].get(k)!=v})"
```

A wrong url, or a deploy without the plugin, returns the spa's `index.html` with a 200, so check
for json rather than the status.

## A missing asset

Past retention, a request for a missing `/assets/*` file is answered by the `asset-not-found`
function (`packages/app/netlify/functions/`, under the package directory): a `404 text/plain` with
`no-store`. It has to be a function because Netlify matches `_headers` by request path, even for
redirects, so any static or redirect answer under `/assets/*` gets the year-long `immutable` and a
browser keeps the miss. That would bite if a later build reproduced a dropped hash, e.g. a revert.

- `path: "/assets/*"` with `preferStatic: true`: a real file always wins, so it runs only on a miss.
- Functions run before `_redirects`, so the spa's `/* /index.html 200` never sees the request.
- The `_redirects` rules are a fallback should the function be absent: a 302 to
  `/asset-not-found/<name>`, a `no-store` 404, though that 302 itself is cached as `immutable`.

## Keeping ui chunk names stable

A chunk's hash covers the names of the chunks it imports, so one rename spreads to every importer.
The goal is that a change renames only the ui whose code changed.

| change | before | now | ui chunks renamed now |
|---|---|---|---|
| jsh worker (`handle-message.ts`) | 15 of 62 | 3 | none |
| `jsh/world/core.ts` | 14 of 62 | 3 | `Jsh` |
| `MapEdit.tsx` | 14 of 62 | 3 | `MapEdit` |

The three are the changed chunk, the entry, and `routes` or `register`, none of which any ui
imports. Startup went from 209K to 216K gzip, and from 6 chunks to 16.

Two hubs used to rename everything:

- **`ui.store` imported `uiRegistry`**, which holds all eight `lazy(() => import(…))`, and every ui
  imports `ui.store`. It needs only keys, schemas and `getDefaultTabs`, so it now imports
  `@npc-cli/ui-registry/schemas` and `/default-ui`.
- **Every chunk imported the entry**, which holds the route chunks' names and `jsh.worker`'s url
  (via `register.ts`). `stableEntryPlugin` walks the entry's static graph in `buildEnd`, keeps the
  modules that name a hashed chunk (an `import()`, a `new URL(…, import.meta.url)`, or importing
  either), and moves the rest to `app-core` / `app-vendor`. Nothing imports the entry after that.
  Entry-reachable worker spawners (`nav-worker-factory`, `register`) get their own chunks, so World
  renames only with `nav.worker`. `STABLE_ENTRY_DEBUG=1` lists the name-holders.

To keep it that way:

- Nothing a ui imports may value-import `@npc-cli/ui-registry` or another ui package's root, since
  each holds lazy imports. `import type` is erased, so it is fine; for values use a subpath
  (`@npc-cli/ui__map-edit/schema`, `@npc-cli/ui-registry/schemas`).
- Don't give the ui chunks fixed names. A new `MapEdit.js` would import a new `index-*.js`, which
  carries a second React: the hash is what stops an old page loading incompatible code.

Pitfalls met along the way:

- Without `entriesAware`, `app-core` swallowed modules the entry only reaches through barrel
  re-exports, and startup grew by 46K gzip.
- Isolating every worker spawner pulled `PhysicsWorker` and its dependencies (292K) into startup,
  since a group takes its modules' dependencies too (`includeDependenciesRecursively`). Only
  entry-reachable spawners are isolated.
- `advancedChunks` (vendor or react leaves), `modulePreload: false` and an empty
  `resolveDependencies` each left all 14 renames.

## Measuring

Append a top-level `console.log("probe")` to a file, since minification keeps it, then build and
diff the file names in `dist/assets` against a build without it. For startup, follow the static
imports from `index.html`'s scripts and sum their gzip sizes: a chunking change can quietly move
lazy code into startup.
