# assign variable

```sh
# deep thought textually
echo 42 >answer
answer=$( echo 42 )

# deep thought numerically
expr 42 >answer
answer=$( expr 42 )
answer=$( call '() => 42')
echo 42 | map Number >answer
```

# loops

<!-- Each command loop iteration is forced to take a minimum of 300ms.
Use JavaScript loops to avoid this restriction.
This avoids unstoppable infinite loops at the level of commands.
It also aligns command loops with human reaction speeds. -->

```sh
for x in $( range 5 ); do
  x
done

for x in $( seq 5 ); do
  x
done

for x in {1..5}; do
  x
done

for x in {a..h..2} {5..1}; do
  x
done

for x in $( sleep 1; echo foo ) $( sleep 1; echo bar); do
  x
done

c=5; while test $c; do
  c
  c+=-1
done

localLoop() {
  local c=$1
  while test $c; do
    echo $c; c+=-1
  done
}
localLoop 10

while true; do
  echo Ctrl-C to stop...
done
```

# shell vs js functions

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

# local variables

```sh
( local y; y=42; echo $y )
( local y; y='{ foo: 42 }'; y/foo )
```

# if then elif else

```sh
if true; then echo foo; else echo bar; fi
if false; then echo foo; else echo bar; fi
if false; then echo foo; elif true; then echo bar; else echo baz; fi
if false; then echo foo; elif false; then echo bar; else echo baz; fi

# using builtin `test`
if test '1 > 2'; then echo TEST PASSED; else echo TEST FAILED; fi
if test '2 > 1'; then echo TEST PASSED; else echo TEST FAILED; fi
```

# pipe semantics

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
while true; do echo | false; echo hello; done

# terminates because first pipe-child killed
# exit code 130
run '({ api }) { throw api.getKillError(); }' | take 1

# terminates because last pipe-child killed
# exit code 130
take 1 | run '({ api }) { throw api.getKillError(); }'

# ctrl-c should kill whole while loop
awaitWorld
while true; do click 1 >clicked; clicked/meta/nav; done
```
