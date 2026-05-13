# Example commands

```sh
spawn npc:rob at:$( pick 1 )
while true; do
  move --force npc:rob to:$( pick meta.floor 1 )
done
```

```sh
w e.toggleLock g0d15
w n.rob | w e.checkNpcTargetUnreachable -
```