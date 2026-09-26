# controls

```sh
# move npc via mouse
pick meta.{floor,do,point} | move npc:rob --backstep --force

# move npc via keyboard
wasd_delta npc:rob | move npc:rob --force

# strafe npc via mouse
pick meta.{floor,do,point} | move rob --strafe --force

# strafe npc via keyboard
wasd_delta npc:rob | move npc:rob --strafe --force

# move player
pick meta.{floor,do,point} | move npc:/shared/pred/player --force

# move last picked
pick meta.{floor,do,point} | move npc:/shared/pred/lastPicked --force

# look on long press
pick --long | look npc:rob --force
```
