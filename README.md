# Dependencies

Install pnpm
> https://pnpm.io/installation

## `packages/app`

### react-grid-layout

https://github.com/react-grid-layout/react-grid-layout?tab=readme-ov-file#installation


### @mdx-js/rollup

https://www.npmjs.com/package/@mdx-js/rollup

## `packages/parse-sh`

### golang setup

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

### golang -> wasm

Install tinygo

> On MacOS
>
> https://tinygo.org/getting-started/install/macos/
>
> ```sh
> brew tap tinygo-org/tools
> brew install tinygo
> ```

We use it to generate WASM (https://tinygo.org/docs/guides/webassembly/) following the method of https://github.com/un-ts/sh-syntax


```sh
# generate packages/parse-sh/main.wasm with current structs
pnpm -F @npc-cli/parse-sh build:wasm
```
