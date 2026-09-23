# Gotchas

Things that have bitten before. Mask SVG notes are in [starship-sheets](starship-sheets.md), and the
worker HMR one in [workers](workers.md).

## Graphics

- Decor SVG `width` and `height` take precedence over `viewBox`. Ensure they are also changed on
  resize in Boxy SVG.
- `skia-canvas`'s `loadImage` sporadically supports filters inside SVGs:
  - it seems to work for data-url `<image>` in skins;
  - it does not seem to work for decor with SVG paths, even when rasterized as `<image>`.
- Shaders can have at most 8 vertex attributes — check the console for errors.
- Height-related MapEdit symbol dimensions are already in metres, e.g. `y=1`, `h=1`.
- Boxy SVG: cutting a circle from a square leaves it empty when the circle's radius matches the
  square's half-width.
- Boxy SVG: transformed shapes may not be rendered correctly by `skia-canvas`. Converting to a path
  and reducing the transform seems to fix it.

## Scripts

- `pnpm gen-assets-json --force` recomputes stratification, in case it is out of sync.
- A Node script saying "Could not find a declaration file for module" on importing a JS path can be
  fixed by emitting declarations, e.g.

  ```sh
  cd packages/util/src/legacy
  npx tsc generic.js --declaration --allowJs --emitDeclarationOnly
  ```

## Geometry

- Hull doors can have `navRectId` `-1` if hull walls are not properly aligned.
- `gmId` detection: map transforms must be aligned to `(15 * n, 15 * n)`.

## General

- Jsh needs both `WORLD_KEY` and `CACHE_SHORTCUTS` to connect to a World, e.g.

  ```sh
  WORLD_KEY=world-0
  CACHE_SHORTCUTS="{ w: 'WORLD_KEY' }"
  ```

- Sometimes it is worth playing the World to debug out-of-sync updates.
- Confusing type errors arise when auto-added imports reference other packages via relative paths
  instead of e.g. `@npc-cli/foo`.
- Hot module reload can yield an unreachable, malformed state on adding a library.
- In VSCode, reconnect to an MCP server via `/mcp`, then click the button.
