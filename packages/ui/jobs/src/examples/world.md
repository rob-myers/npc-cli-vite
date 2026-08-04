# pick

```sh
# pick things
pick
# pick one thing
pick 1
# pick thrice
pick 3
# pick from the floor
pick 1 meta.floor
# pick something's meta
pick 1 as:meta
# pick string identifiers of doors or switches
pick as:meta.gdKey
```

# spawn

```sh
# spawn (or respawn) rob at picked position
spawn npc:rob at:$( pick 1 )

# spawn at 1st pick looking towards 2nd pick
spawn npc:rob at:$( pick 1 ) towards:$( pick 1 )

# spawn with skin human-0
spawn npc:rob at:$( pick 1 ) as:human-0

# spawn npcs test0, test1 etc.
pick | spawn npc:test

# two picks per spawn -- position and towards
pick | spawn npc:test as:human-1 look
```

# move

```sh
# move rob to picked position, projected to ground
move npc:rob to:$( pick 1 )

# move rob to picked position on floor
move npc:rob to:$( pick 1 meta.floor )

# move rob sequentially to picked positions
# swallowing errors via --force
while true; do
  move --force npc:rob to:$( pick meta.floor 1 )
done

# move rob to most recent picked
pick | move npc:rob

# move rob sequentially along picked positions
pick | move npc:rob along

# move rob fast
move npc:rob to:$( pick 1 ) fast
```

# doors

```sh
# get a doors gdKey
pick 1 as:meta.gdKey

# toggle a specific door's lock
lock g0d19

lock $( pick 1 as:meta.gdKey )
```

# events

```sh
events /enter-room/
```

# unsorted

```sh
demo_npc_ui rob

# whilst on navmesh
w n.rob.agent.maxSpeed
```