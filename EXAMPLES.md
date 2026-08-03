# Example commands

```sh
# pick something
pick
# pick one thing
pick 1
# pick from the floor
pick 1 meta.floor
# pick something's meta
pick 1 as:meta

# spawn or respawn rob at picked position
spawn npc:rob at:$( pick 1 )

# move rob to picked position (projected to ground)
move npc:rob to:$( pick 1 )
# move rob to picked position on ground
move npc:rob to:$( pick 1 meta.floor )

# move rob sequentially to picked positions
# swallowing errors via --force
while true; do
  move --force npc:rob to:$( pick meta.floor 1 )
done

# move rob to most recent picked position
pick 1 | move npc:rob
# move rob sequentially to picked positions
pick 1 | move npc:rob along

# move two npcs interactively to same position
# pause so one-at-a-time
pick | move npc:rob
pick | move npc:kate

demo_npc_ui rob

# whilst on navmesh
w n.rob.agent.maxSpeed

move npc:rob to:$( pick 1 ) fast
```

```sh
# get a doors gdKey
pick 1 as:meta.gdKey
# toggle a specific door's lock
lock g0d19
lock $( pick 1 as:meta.gdKey )
```
