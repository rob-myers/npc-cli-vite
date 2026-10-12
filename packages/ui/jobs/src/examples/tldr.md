# controls

```sh
# pointer moves npc
pick meta.{floor,do} | move npc:rob --backstep --force

# keys move npc
wasd_delta --nav npc:rob | move npc:rob --force

# pointer strafes npc
pick meta.{floor,do} | move rob --strafe --force

# keys strafe npc
wasd_delta npc:rob | move npc:rob --strafe --force

# pointer moves player
pick meta.{floor,do} | move /shared/pred/player --force

# keys move player
wasd_delta --nav /shared/pred/player --force |
  move /shared/pred/player --force

# last picked moves
pick meta.{floor,do} | move /shared/pred/lastPicked --force

# long pressed looks
pick --long | look npc:rob --force

# keys look
wasd_delta npc:rob | look npc:rob --force
```
