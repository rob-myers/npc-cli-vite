# Tooling

Tools beyond Node and pnpm, and what needs each. None is needed just to run `pnpm dev`.

| Tool | Needed for |
|---|---|
| `skia-canvas` build | Asset scripts — allow it with `pnpm approve-builds` ([npm](https://www.npmjs.com/package/skia-canvas)) |
| pngquant | Shrinking spritesheets in `gen-starship-sheets` (it warns and carries on without) |
| ImageMagick | `pnpm extract-starship-pngs …` |
| Go + TinyGo | Rebuilding `packages/parse-sh/main.wasm` |

## pngquant

```sh
brew install pngquant

# manual usage
cd packages/app/public/sheet
pngquant --ext .pngquant.png *.png
```

## ImageMagick

Needed for e.g. `pnpm extract-starship-pngs root Symbols symbol-root`.

```sh
brew install imagemagick
```

```sh
magick '200x100 Iris Valves.png'  -precision 4 -format "%[pixel:p{0,0}]\n" info:

# does the top line contain a fully opaque pixel?
magick 'Cargo 007 [20x20].png' -crop x1+0+0 +repage -alpha extract -format "%[fx:maxima == 1 ? 1 : 0]\n" info:

magick 'Fuel 057 [25x80].png' -shave 1x1 -fuzz 1% -trim some.png
# magick: invalid colormap index `Fuel 057 [25x80].png' @ error/colormap-private.h/ConstrainColormapIndex/35.
```

## Go and TinyGo (`packages/parse-sh`)

```sh
brew install go@1.23
go version
# go version go1.23.12 darwin/arm64

# inside your profile
export GOPATH=$HOME/go
export PATH="$GOPATH/bin:$PATH"
```

```sh
go mod download
go get

# generate structs_easyjson.go
cd processor
easyjson -all structs.go
```

TinyGo compiles it to WASM ([guide](https://tinygo.org/docs/guides/webassembly/)), following the method of [sh-syntax](https://github.com/un-ts/sh-syntax). On macOS ([install](https://tinygo.org/getting-started/install/macos/)):

```sh
brew tap tinygo-org/tools
brew install tinygo
```

```sh
# generate packages/parse-sh/main.wasm with current structs
pnpm build:wasm
```

## MDX

`packages/app` renders MDX via [@mdx-js/rollup](https://www.npmjs.com/package/@mdx-js/rollup).
