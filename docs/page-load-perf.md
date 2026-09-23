# Page load performance

What was measured on 2026-09-11, what changed, and what was tried and dropped. The numbers are
Lighthouse desktop (simulated throttling), reports kept in `e2e/`.

| report | what |
|---|---|
| `npc-cli-vite.netlify.app-2026…json` | the prod deploy that prompted this, run with a browser extension active (~330 ms of its TBT) |
| `localhost-preview-before-…json` | `main` before any change, built and served locally with brotli |
| `localhost-preview-after-…json` | the same machine and server, after |

| metric | before | after |
|---|---|---|
| total blocking time | 376–393 ms | 16–37 ms |
| JS bootup | 1384 ms | ~785 ms |
| `index` chunk scripting | 1030 ms | ~455 ms |
| LCP (simulated) | 1482 ms | 1506 ms |
| performance score | 0.64–0.77 | 0.80–0.93 |

Paint was never the problem: first paint is ~0.6 s in both. The score was lost to main-thread
JavaScript after first paint, and nearly all of that was the world booting under React's
scheduler — which is why Lighthouse attributed it to the `index` chunk.

## Where the time went

A CPU profile of an unminified build (see *Measuring* below) put the boot's blocking time in
this order:

1. **`TexArray.updateIndex`, ~630 ms.** Each floor and ceiling layer was written by
   `getImageData` on a 3030² canvas (a 37 MB read-back) and a copy into a CPU mirror of the
   whole `DataArrayTexture`, which three then uploaded again. Three floor layers, drawn twice
   (hulls, then the full draw), plus two ceiling layers.
2. **The shell parser's wasm, instantiated per parse.** `parse()` in `packages/parse-sh`
   ran `WebAssembly.instantiate` of the 2.6 MB module and a fresh Go runtime for every line the
   tty ran at boot.
3. **`hashJson(assets)`, 50 ms.** The world's assets hashed via the pretty-printing
   stringifier, over 1.3 MB of JSON.
4. Skin SVG overlays fetched and rasterised before the world could show.

## What changed

- **`service/tex-array.ts` — the `gpu` option.** A `gpu: true` array keeps a `CanvasTexture`
  of its own canvas and writes a layer with `renderer.copyTextureToTexture(src, tex, null,
  (0, 0, layer))`: the canvas goes to the GPU as a texture upload, and the layer is filled by a
  GPU-side copy. No read-back, no mirror. Per layer this is under 1 ms on the main thread
  (measured headless and headed). The floor, ceiling and obstacle arrays opt in.
  - the canvas is created **without** `willReadFrequently`, so the browser keeps it GPU-backed
    and the upload is a blit rather than a CPU copy
  - `tex.source.dataReady = false` with `needsUpdate = true`: three creates the array texture at
    full size on first use without uploading the zero mirror. Without the `needsUpdate` three
    stands in a 1x1 default texture and every copy fails validation
  - the layers live only on the GPU. `update()` is a no-op for these arrays, and
    `WorldView.onCreated` redraws floor, ceiling and obstacles on a replacement GPU context
    (the Chrome cmd+shift+t double init the old `texFloor.update()` covered)
  - arrays that pass `data` in, or are read back (`texSkin` by the debug skin viewer), stay on
    the CPU path
- **`packages/parse-sh/src/parse.ts`.** One instance, made on first use and kept. `go.run` is
  not awaited: TinyGo's `main` returns at once and the exports stay callable; the run promise
  resolves only on `proc_exit`, which never comes. Verified in node: four parses, one
  instantiation, and a `ParseError` does not poison the next parse.
- **`World.tsx`:** `hashJson(state.assets, false)` — 9 ms instead of 50.
- **`NPCs.tsx`:** the sheet skins draw first; the SVG overlays are a second query that redraws
  the affected skins when they arrive.
- **`index.html`:** `<link rel="preload">` for `assets.json` and `sheets.json`. They start
  ~830 ms earlier (during script evaluation rather than after the world mounts) and are neutral
  to Lighthouse.
- **`public/_headers`:** `/assets/*` immutable for a year on Netlify (prod was
  `max-age=0, must-revalidate`).

## Tried and dropped

Each was measured on the same local server; none survived.

- **`modulepreload` of the `World` chunk.** Starts its download ~380 ms earlier but doubled
  the *observed* LCP (740 → 1500 ms): the parse and link of a 1.9 MB module lands on the main
  thread just as the LCP element wants to paint.
- **`preload` of `main.wasm`.** The parser is not needed until the tty runs a line; in the
  Lighthouse window it is never fetched at all, so the preload only took bandwidth from
  everything else. Simulated LCP rose by ~600 ms. `fetchpriority="low"` did not help the
  simulation.
- **Skipping zod validation of `assets.json` in prod.** The decode measured 12–24 ms, and the
  codecs also build `Rect`/`Poly` instances from the JSON, so there is nothing to skip.

## Still open

- **A flaky layout shift, present on `main` before any of this.** In about half of runs the
  right allotment pane (`div.split-view-view`) shifts with CLS 0.258, which alone moves the
  score between ~0.80 and ~0.93. The pane sizes are presumably applied after the first paint.
  Treat CLS as noise when comparing runs until it is fixed.
- With TBT under 40 ms the score is now bounded by LCP (the Jobs library's first code block)
  and the CLS above. The `World` chunk (1.9 MB, 267 KB unused on load) and the accessibility,
  `robots.txt` and source-map audits from the original report are untouched.

## Measuring

Lighthouse against `vite preview` is misleading: it does not compress the wasm, so the
simulation sees 2.6 MB where prod sends 770 KB. Serve the build with something that does
(`pnpm dlx serve -l 4174 dist` sends brotli, `application/wasm` included), then

```sh
pnpm dlx lighthouse@12 http://localhost:4174/ --preset=desktop --only-categories=performance \
  --chrome-flags="--headless=new --user-data-dir=/tmp/lh-profile" --output=json --output-path=out.json
```

Run it two or three times; the simulated metrics are stable, the CLS is not. For a fair
before/after, build `main` into another directory (`vite build --outDir dist-base`) and serve
it on a second port.

To see *what* is slow, profile an unminified build: `vite build --outDir dist-prof --minify false
--sourcemap`, serve it, and record a CPU profile of a cold load — Chrome's performance panel, or
`Profiler.start` / `Profiler.stop` over the DevTools protocol (node's built-in `WebSocket` is
enough; no library needed). Aggregate self time by function. Two things to know when reading it:
native calls such as `getImageData` are charged to the JS function that made them, and V8
inlines small callees into their caller, so a hot `updateIndex` can be hiding three's copy
functions inside it. Timing individual calls with `performance.now()` settles that.
