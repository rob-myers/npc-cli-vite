# controls

```sh
# move to floor or doable
pick meta.{floor,do} | move npc:rob force

# keyboard controls
wasd_delta npc:rob | move npc:rob force

# move player
pick meta.{floor,do} | move npc:/shared/pred/player force

# move last picked
pick meta.{floor,do} | move npc:/shared/pred/lastPicked force

# look on long press
pick --long | look npc:rob force
```
