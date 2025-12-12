# TODO

- ✅ initial setup (thanks Jason Yu)
  - vite
  - pnpm
  - tailwind
  - biome
  - tanstack router
  - nested tsconfigs
  - monorepo with catalog
  - package.json exports

- add react-query

- 🚧 packages/cli
  - https://github.com/un-ts/sh-syntax
  - towards go project

# Dependencies

## `packages/cli`

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
cd packages/cli
pnpm wasm
# generates main.wasm
```


