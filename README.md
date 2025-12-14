# Dependencies

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

cd processor
# generate structs_easyjson.go
easyjson -all structs.go
```

### golang -> wasm setup

https://tinygo.org/getting-started/install/macos/

```sh
brew tap tinygo-org/tools
brew install tinygo
```

https://tinygo.org/docs/guides/webassembly/

```ts
//export parse
func parse(...)
```

```sh
# generate packages/parse-sh/main.wasm with current structs
pnpm -F @npc-cli/parse-sh build:wasm
```

### loading wasm in browser

https://github.com/tinygo-org/tinygo/blob/3869f76887feef6c444308e7e1531b7cac1bbd10/targets/wasm_exec.js

https://tinygo.org/docs/guides/webassembly/wasm/

types for Go provided by tinygo in packages/cli/vendors/wasm_exec.js