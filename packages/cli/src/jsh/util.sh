# alias for get
cat() {
  get "$@"
}

clone() {
  map 'x => JSON.parse(JSON.stringify(x))'
}

# usage: `expr location | pretty`
keys() {
  map Object.keys
}

# usage: `expr 42 | keysAll`
keysAll() {
  map 'x => Array.from(new Set(
    [Object.getPrototypeOf(x), x.constructor, x].flatMap(Object.getOwnPropertyNames)
  ))'
}

# usage: `expr location | pretty`
pretty() {
  map '(x, { api }) => api.pretty(x)'
}

# usage: `expr location | json`
json() {
  map '(x, { api }) => api.json(x)'
}

# usage: `range 10`
range() {
  call '({ args }) =>
    Array.from({ length: Number(args[0]) }).map((_, i) => i);
  ' "$1"
}

# usage: `readtty 0`
readtty() {
  call '({ api, args }) => api.isTtyAt(...args.map(Number))' $1
}

# usage: `seq 10`
seq() {
  range "$1" | split
}
