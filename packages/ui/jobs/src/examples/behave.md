
# move

```sh
# keep moving rob to next picked (1)
pick | move npc:rob

# [1] but can only pick floor or doable
pick meta.{floor,do} | move npc:rob

# [1] but follow picked in order
pick | move npc:rob along

# move rob once to picked projected to ground (2)
move npc:rob to:$( pick 1 )

# [2] but must pick floor
move npc:rob to:$( pick 1 meta.floor )

# move rob sequentially to picked positions
while true; do
  move --force npc:rob to:$( pick meta.floor 1 )
done

# [2] but fast
move npc:rob to:$( pick 1 ) fast
```