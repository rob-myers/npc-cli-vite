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

## golang setup (packages/cli)

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
