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
# tty-0
pick | move npc:rob
# tty-1
pick | move npc:kate

# move two npcs interactively interleaved
# tty-0
while true; do move npc:rob to:$( pick 1 --fifo ); done
# tty-1
while true; do move npc:kate to:$( pick 1 --fifo ); done

w bubble.ensure rob
w bubble.delete rob
w bubble.ensure rob >/dev/null

w n.rob.agent.maxSpeed
move npc:rob to:$( pick 1 ) fast

```

```sh
# toggle a specific door's lock
w e.toggleLock g0d15
# toggle a picked door's lock
w e.toggleLock $( pick 1 as:meta.gdKey )
```

```sh
w gms.0.doors | split | map 'x => x.roomIds'
```