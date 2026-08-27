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