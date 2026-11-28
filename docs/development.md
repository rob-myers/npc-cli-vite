# Development

A pnpm monorepo: a Vite React app hosting tabbed UIs.

## Quick start

Needs Node 24 (see `.nvmrc`) and [pnpm](https://pnpm.io/installation).

```sh
pnpm install         # also points git at .githooks/
pnpm approve-builds  # allow skia-canvas' native build
pnpm dev             # http://localhost:5173
```

On a phone, `pnpm dev-hotspot` serves on your network: find your address with `ipconfig getifaddr en0` and open `https://<address>:5173`, accepting its self-signed certificate. It is https because a phone only offers WebGPU on a secure origin.

Some scripts need extra tools (pngquant, ImageMagick, Go/TinyGo) — see [tooling.md](tooling.md).

## Layout

| Package | What it is |
|---|---|
| `packages/app` | Vite app entry, and the public assets: sheets, symbols, maps, decor, skins |
| `packages/ui/world` | The 3D world: camera, npcs, navigation, lighting, floor |
| `packages/ui/*` | The other UIs: `jsh`, `map-edit`, `decorator`, `manifest`, `tabs`, `jobs`, `skip-net`, … |
| `packages/cli` | The shell behind Jsh: tty, processes, and the `jsh` world commands |
| `packages/media` | Static asset keys, symbol metadata, source images e.g. the geomorphs |
| `packages/util` | Shared geometry (`Mat`, `Vect`, `Rect`), services, TSL helpers |
| `packages/parse-sh` | Shell parser, Go compiled to WASM |
| `packages/ui-sdk`, `ui-registry` | How a UI is defined, registered and persisted |
| `scripts` | Vite plugins, the MapEdit save API, asset generation |

## Scripts

| Command | When |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm preview` | Run, build, or serve the build |
| `pnpm typecheck` | Type-check every package (`tsgo -b`) |
| `pnpm check` | Lint and format check (Biome) |
| `pnpm gen-assets-json` | Rebuild `assets.json` (maps, a hash per layout), `layout/{gmKey}.json` and `assets-edit.json` (symbols, for drafts) from MapEdit files — runs by itself on save in dev, in the dev server's own process, keeping each hull's layout whilst its inputs are unchanged (empty on start; the WorldMenu's **assets** button rebuilds all); `--force` recomputes symbol stratification. A World fetches the index, then only its map's layouts |
| `pnpm gen-starship-sheets` | Rebuild the obstacle spritesheet after changing obstacles — or the **obstacles** button in the World menu |
| `pnpm gen-decor-sheets` / `pnpm gen-skin-sheets` | Rebuild the decor or skin spritesheets |
| `pnpm gen:ui` / `pnpm gen-pkg` | Scaffold a new UI or package |
| `pnpm sync-readme` | Rewrite README.md from the About modal (`about.mdx`) |

## Git hooks

Hooks live in `.githooks/`; `pnpm install` enables them via the `prepare` script.

| Hook | What it does |
|---|---|
| `pre-commit` | Runs `pnpm gen-starship-sheets` and stages its output. Once `about.mdx` is staged, runs `pnpm sync-readme` and stages README.md |
| `pre-push` | Runs `pnpm gen-starship-sheets` |

## Docs

| Doc | About |
|---|---|
| [floor](floor.md) | How the floor is drawn, and `deckConfig` |
| [starship-sheets](starship-sheets.md) | Obstacle spritesheets, masks, and MapEdit `dup` |
| [map-edit](map-edit.md) | Where a saved MapEdit file goes |
| [decorator](decorator.md) | The Decorator panel and runtime decor |
| [workers](workers.md) | The physics and nav web workers |
| [web-rtc-worlds](web-rtc-worlds.md) | One World joining another over WebRTC |
| [navcat](navcat.md) | The navmesh, the crowd and its agents, and the navcat patch |
| [npc-outlines](npc-outlines.md) | The border drawn round npcs |
| [page-load-perf](page-load-perf.md) | Page load measurements |
| [screen-slideshows](screen-slideshows.md) | Turning a screen recording into a README slideshow |
| [tooling](tooling.md) | Optional tools, and which scripts need them |
| [gotchas](gotchas.md) | Things that have bitten before |
| [blockbench](blockbench.md) | Modelling npcs in Blockbench |
