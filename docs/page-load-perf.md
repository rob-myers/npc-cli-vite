# Page load performance

The ONLY doc for how fast the page and its World load, and how to measure it.

A first load can be slow in two ways:
- **JavaScript on the main thread.** Measured with Lighthouse (2026-09-11): total blocking time
  went from ~385 ms to under 40 ms. Reports are in `e2e/`.
- **A cold GPU.** A deploy preview is a new origin, so a visitor's browser has no compiled
  shaders for it (2026-11-19). The GPU process compiles them, and anything that waits on it
  synchronously blocks the main thread.

Cold GPU, production build, page opened in a fresh tab:

| | before | after |
|---|---|---|
| main thread blocked | 8.2 s | 0.6 s |
| longest task | 3.45 s | 0.34 s, xterm's WebGL start-up |
| `booted` | — | ~14 s, bounded by the GPU's compiling |

On macOS, Metal caches compiled shaders per app, shared by every Chrome profile. With it warm, a
boot blocks for ~0.4 s. A 4x CPU slowdown adds only ~1 s to a cold boot: the time is the GPU's.

## Never wait on the GPU at boot

What waits on a busy GPU process: reading a canvas back (`getImageData`), a WebGL canvas
changing size (Chrome checks `GLES2::GetGLError`), and a material's first draw (its pipeline is
created on the thread that also finishes frames).

- **`TexArray`'s `gpu` option** (`service/tex-array.ts`). The array keeps a `CanvasTexture` of its
  canvas and fills a layer with `renderer.copyTextureToTexture`. Nothing is read back and there is
  no CPU mirror. The floor, ceiling, obstacle and door-label arrays use it.
  - Its canvas has no `willReadFrequently`, so the browser keeps it on the GPU.
  - Its layers live only on the GPU. `update()` does nothing, and `WorldView.onCreated` redraws
    them on a replacement GPU context.
  - An array that passes `data` in, or is read back (`texSkin` by the debug skin viewer), stays
    on the CPU.
- **Door labels are drawn once per boot.** Doors redraws them only when `labelsKey`
  (`gmsHash`, `hash`, `themeKey`, `lastHmr`) changes.
- **`warmPipelines`** (`WorldView`). With no frame drawn (`frameloop: "never"`) it
  `compileAsync`s the pick pass, whose attachments differ from the screen's, so the first tap
  needn't build every material a second pipeline. Dawn creates them on worker threads. The warm
  then sets `w.e.bootedAt`. The screen's pipelines still compile on each material's first draw.
- **A tty is created at its fitted size** (`fitOf`, `packages/cli/src/tty/xterm-fit.ts`), so its
  WebGL canvas never resizes at boot. `Tty`'s fit takes "hidden" from its element, not
  `useMeasure`'s `bounds`, which start at zero and would force a resize.
- **A tty redraws whenever it is seen again** (an `IntersectionObserver` in `BaseTty`). A phone may
  drop a hidden WebGL canvas's pixels, which xterm can't know: switched back to, it stayed black
  until tapped.

## Little on the main thread

- **The shell parser's wasm is instantiated once** (`packages/parse-sh/src/parse.ts`), not per
  parse. `go.run` is not awaited: TinyGo's `main` returns at once and the exports stay callable.
- **`hashJson(state.assets, false)`** in `World.tsx`: 9 ms, where pretty-printing took 50.
- **Skins draw from their sheets first.** The SVG overlays are a second query (`NPCs.tsx`).
- **drei `<Stats>` is off in production**, behind the debug menu's **fps**.
- **The WebRTC probe waits for the boot and an idle moment** (`probeWebRtcWhenIdle`).
- **The hud-toasts wait for `bootedAt`**, then fade in on the compositor (`WorldHud`).

## Nothing ahead of the app

- **Umami's script is `async`** (`index.html`). As `defer` it ran before the app's module entry,
  in document order, so a slow umami server held up the whole app.
- **`assets.json` and `sheets.json` are preloaded** (`index.html`). They start during script
  evaluation, not after the World mounts.
- **`/assets/*` is immutable for a year** (`public/_headers`).
- **`Tabs` isn't lazy** (`ui/tabs/src/index.ts`). Every pane's header shows on the first render,
  not after a chunk arrives. It is 15 KB.
- **The entry holds only what the first render needs.** `PausedPill` loads `run.ts`, and with it the
  shell, xterm and the parser, once a World has mounted. map-edit's root no longer re-exports
  `map-node-api`, whose geometry pulled in `polygon-clipping` and `poly2tri`. That took the entry's
  static graph from 532 KB to 338 KB gzipped.
- **A ui may give its own `loading`** (`UiPackageDef`), which `UiPortalContainer` shows whilst its
  lazy code arrives, else a spinner. The World's is black (`WorldLoading`), so a phone sees the
  header and the World's black, not a grey spinner first.

## Tried and dropped

- **`modulepreload` of the `World` chunk.** Its parse lands just as the LCP element paints, which
  doubled the observed LCP.
- **`preload` of `main.wasm`.** The parser isn't needed until a tty runs a line. The preload only
  took bandwidth.
- **Skipping zod validation of `assets.json` in production.** It costs 12–24 ms, and its codecs
  build `Rect`/`Poly` instances anyway.
- **Fitting a tty before loading xterm's WebGL renderer, or loading it after the first fit.** The
  first didn't stop the resize, and both use xterm's DOM renderer meanwhile.
- **Warming the screen pass too, with decor and npcs restored inside the warm.** It held every
  frame ~0.6 s longer at 4x CPU, on each refresh as well, though the layers had already drawn. A
  refresh's warm went 1.08 s → 0.43 s without it.
- **Hiding `worldGroup` until the warm, on a first map.** No layer's first draw then compiled on
  the GPU's frame thread, so a cold desktop's longest frame gap fell from 4.8 s to 2.2 s. But the
  World no longer appeared bit by bit: on a phone the boot looked worse, refreshes waited for the
  whole warm, and the floor arrived late.

## Still open

- **A cold boot is ~14 s**, bounded by the GPU compiling every pipeline. Only fewer shader
  variants would shorten it.
- **Frames stop for up to ~5 s on a cold boot**, whilst the layers' first draws compile their
  pipelines on the GPU's frame thread. The main thread stays free meanwhile.
- **A flaky layout shift.** In about half of Lighthouse runs the right allotment pane shifts
  (CLS 0.258). Treat CLS as noise when comparing runs.
- **The `World` chunk is 1.9 MB.**

## Measuring

**Main-thread JavaScript, with Lighthouse.** `vite preview` doesn't compress the wasm, so serve
the build with brotli (`pnpm dlx serve -l 4174 dist`), then

```sh
pnpm dlx lighthouse@12 http://localhost:4174/ --preset=desktop --only-categories=performance \
  --chrome-flags="--headless=new --user-data-dir=/tmp/lh-profile" --output=json --output-path=out.json
```

Run it two or three times. For a fair before/after, build `main` into another directory
(`vite build --outDir dist-base`) and serve it on a second port. To see what is slow, profile an
unminified build (`--minify false --sourcemap`). A native call such as `getImageData` is charged
to the JS function that made it.

**A cold GPU, with a trace.**
- Serve the build. Launch Chrome with its own `--user-data-dir`, a `--remote-debugging-port`, and
  `--disable-backgrounding-occluded-windows`: a hidden window stops `requestAnimationFrame`.
- Clear the Metal cache by moving `com.google.Chrome.helper/com.apple.metal` and
  `com.apple.metalfe` (in `getconf DARWIN_USER_CACHE_DIR`) aside. Put them back afterwards.
- Trace from the browser target (`Tracing.start`), then open the app with `Target.createTarget`.
  Navigating from `about:blank` in the same tab adds a ~2 s `Shutdown` task a visitor never sees.
- Find the renderer by its `world-0:*` marks (Timings row): each `pending` key clearing,
  `map-settled`, the `warm` measure and `booted`. Long tasks are `ThreadControllerImpl::RunTask`
  over 50 ms. `ReadbackImagePixels` or `GLES2::GetGLError` inside one is a wait on the GPU.
  `FireAnimationFrame` shows when frames stopped.
- Single cold runs vary. A slow third-party script, or other work on the machine, can shift the
  whole boot.
