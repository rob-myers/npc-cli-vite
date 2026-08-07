# assign

```sh
# assign string "42"
echo 42 >answer

# assign number 42
expr 42 >answer

# assign number 42
answer=$( expr 42 )

# assign number 42
answer=$( call '() => 42')

# assign number 42
echo 42 | map Number >answer

# locally assign number 42
( local y=42; echo $y )

# locally assign and then read number 42
( local y='{ foo: 42 }'; y/foo )

```

# loops

<!-- Each command loop iteration is forced to take ≥ 300ms.
Use JavaScript loops to avoid this restriction.
Avoids unstoppable shell syntax while aligning with human reaction speeds. -->

```sh
# iterate through array [0...4]
for x in $( range 5 ); do
  x
done

# iterate through values 0...4
for x in $( seq 5 ); do
  x
done

# iterate through brace expansion
for x in {1..5}; do
  x
done

# iterate through brace expansions
for x in {a..h..2} {5..1}; do
  x
done

# iterate through lazy values
for x in $( sleep 1; echo foo ) $( sleep 1; echo bar); do
  x
done

# decrement until zero
c=5; while test $c; do
  c; c+=-1
done

# decrement local var until zero
localLoop() {
  local c=$1
  while test $c; do
    c; c+=-1
  done
}
localLoop 10

# infinite loop 🔔 either copy-paste or kill using UI above
while true; do
  echo ctrl-c or kill to stop...
done
```

# if then

```sh
# follow first branch
if true; then echo foo; else echo bar; fi

# follow second branch
if false; then echo foo; else echo bar; fi

# follow second then first branch
if false; then echo foo; elif true; then echo bar; else echo baz; fi

# follow second branch twice
if false; then echo foo; elif false; then echo bar; else echo baz; fi

# follow first branch
if test '2 > 1'; then echo TEST PASSED ✅; else echo TEST FAILED ❌; fi

# follow second branch
if test '1 > 2'; then echo TEST PASSED ✅; else echo TEST FAILED ❌; fi
```

# pipe 

<!-- pipe-child termination info -->

```sh
# `foo`
echo foo | map 'x => x'

# `3`, `3`
{ echo foo; echo bar; } | map length

# [3,3]
{ echo foo | map length; } | map 'x => [x,x]'
# `0`, `1`, `2`, `3`, `4`
seq 10 | take 5

# if type foo⏎ then `102`, `111`, `111`
split | map charCodeAt 0

# ctrl-c should exit early
# exit code 130 on ctrl-c
echo foo | sleep 10

# `foo` then terminates immediately
sleep 10 | echo foo

# `foo` (pause) `bar` then hangs (can ctrl-c)
{ echo foo; echo bar; } | while true; do take 1; sleep 2; done

# hi rob
echo hi $( echo rob | take 1 )

# `1`
false; echo ${?}

# `1`
( false; echo ${?} )

# `1`
echo | false; echo $?

# `1` `0`
{ false; echo ${?}; } & sleep 1; echo $?

# take 3 terminates immediately
take 3 | true

# should output `hi`
echo hi $( echo rob | false )

# should output `hi`
echo hi $( echo rob | true )

# should output `hello` continually
# 🚧 util to guard against bg exec
while true; do echo | false; echo hello; done

# terminates because first pipe-child killed
# exit code 130
run '({ api }) { throw api.getKillError(); }' | take 1

# terminates because last pipe-child killed
# exit code 130
take 1 | run '({ api }) { throw api.getKillError(); }'
```

# etc

```sh
narrate Listen to the sound of my voice

# narrate () {
#   run util narrate "${@}"
# }
declare -f narrate

# async function narrate({ api, args }, opts = api.jsArg(args, { as: "voice" })) {
# ...
call 'x => x.lib.util.narrate'
```