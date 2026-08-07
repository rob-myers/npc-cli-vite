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
spawn npc:rob at:$( pick 1 ) look:$( pick 1 )

# spawn with skin human-0
spawn npc:rob at:$( pick 1 ) as:human-0

# spawn npcs test0, test1 etc.
pick | spawn npc:test


# two picks per spawn -- position and towards
pick | spawn npc:test as:human-1 look
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
demo_npc_ui npc:rob

# whilst on navmesh
w n.rob.agent.maxSpeed
```