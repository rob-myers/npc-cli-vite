# controls

```sh
# move to floor or doable
pick meta.{floor,do} | move npc:rob

# keyboard controls
wasd_delta npc:rob | move npc:rob
```

# selection

```sh
# save picked npcKey as /shared/selected
pick meta.npc as:meta.npcKey >/shared/selected
```

```sh
# save picked npcKey and toggle selector ring
pick meta.npc as:meta.npcKey | while take 1 >/shared/selected; do
  demo_selector path:/shared/selected prevPath:/shared/selected-prev
done
```