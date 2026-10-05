# controls

```sh
# move npc via pointer
pick meta.{floor,do,point} | move npc:rob --backstep --force

# move npc via keys
wasd_delta --nav npc:rob | move npc:rob --force

# strafe npc via pointer
pick meta.{floor,do,point} | move rob --strafe --force

# strafe npc via keys
wasd_delta npc:rob | move npc:rob --strafe --force

# move player
pick meta.{floor,do,point} | move $( playerKey ) --force

# move last picked
pick meta.{floor,do,point} | move $( lastPicked ) --force

# look on long press
pick --long | look npc:rob --force

# look via keys
wasd_delta npc:rob | look npc:rob --force
```
