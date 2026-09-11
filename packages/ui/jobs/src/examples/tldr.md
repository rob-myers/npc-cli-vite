# controls

```sh
# move to floor or doable
pick meta.{floor,do} | move npc:rob

# keyboard controls
wasd_delta npc:rob | move npc:rob

# move player
pick meta.{floor,do} | move npc:/shared/pred/player

# move last picked
pick meta.{floor,do} | move npc:/shared/pred/lastPicked
```
