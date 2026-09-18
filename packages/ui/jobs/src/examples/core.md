# pick

```sh
# pick a thing
pick 1

# keep picking
pick

# pick thrice
pick 3

# pick floor once
pick 1 meta.floor

# pick a thing's meta
pick 1 as:meta

# keep picking door keys
pick as:meta.gdKey
```

# spawn

```sh
# spawn rob at pick
spawn npc:rob at:$( pick 1 )

# spawn at pick, look at 2nd pick
spawn npc:rob at:$( pick 1 ) look:$( pick 1 )

# spawn with skin human-0
spawn npc:rob at:$( pick 1 ) as:human-0

# spawn npcs foo-0, foo-1 etc.
pick | spawn npc:foo- as:human-1

# two picks per spawn (at, look)
pick | spawn npc:test as:human-1 look
```

# move

```sh
# keep moving rob to next picked (1)
pick | move npc:rob

# [1] but only pick floor or doable
pick meta.{floor,do} | move npc:rob

# [1] but in order
pick | move npc:rob along

# move once to ground projected pick (2)
move npc:rob to:$( pick 1 )

# [2] but must pick floor
move npc:rob to:$( pick 1 meta.floor )

# [1] but in order floor only
while true; do
  move --force npc:rob to:$( pick meta.floor 1 )
done

# [2] but fast
move npc:rob to:$( pick 1 ) fast
```


# doors

```sh
# lock clicked door
lock $( pick 1 as:meta.gdKey )

# unlock clicked door
unlock $( pick 1 as:meta.gdKey )

# click to see door gdKey
pick as:meta.gdKey

# lock a specific door
lock g0d19
```

# events

```sh
events /enter-room/
```

# remove

```sh
# remove npc rob
remove npc:rob

# remove all npcs
remove npcs

# remove all decor
remove decor

# remove named npcs or decor
remove test{0..5}
```

# w

```sh
# get npc rob
w n.rob.agent

# log rob to console
w n.rob.agent | log

# maxSpeed
w n.rob.agent.maxSpeed

# toggle room lit
w e.setRoomLit g0r2

# reset manual lighting
w e.clearHandLitRooms
```