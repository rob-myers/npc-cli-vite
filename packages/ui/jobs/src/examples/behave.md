
# move

```sh
# move rob to most recent picked
pick | move npc:rob

# only move to floor or doable
pick meta.{floor,do} | move npc:rob

# move rob sequentially along picked positions
pick | move npc:rob along

# move rob to picked position, projected to ground
move npc:rob to:$( pick 1 )

# move rob to picked position on floor
move npc:rob to:$( pick 1 meta.floor )

# move rob sequentially to picked positions
# swallowing errors via --force
while true; do
  move --force npc:rob to:$( pick meta.floor 1 )
done

# move rob fast
move npc:rob to:$( pick 1 ) fast
```