# pick

```sh
# pick a thing
pick 1

# keep picking
pick

# pick thrice
pick 3

# pick once from the floor
pick 1 meta.floor

# pick one thing's meta
pick 1 as:meta

# keep picking door identifiers
pick as:meta.gdKey
```

# spawn

```sh
# spawn (or respawn) rob at picked position
spawn npc:rob at:$( pick 1 )

# spawn at 1st pick looking towards 2nd pick
spawn npc:rob at:$( pick 1 ) look:$( pick 1 )

# spawn with skin human-0
spawn npc:rob at:$( pick 1 ) as:human-0

# spawn npcs test0, test1 etc.
pick | spawn npc:test


# two picks per spawn -- position and towards
pick | spawn npc:test as:human-1 look
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

# remove npcs or decor named test0 ... test5
remove test{0..5}
```

# unsorted

```sh
demo_npc_ui npc:rob

# whilst on navmesh
w n.rob.agent.maxSpeed
```