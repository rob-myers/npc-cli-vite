
# dynamic decor

```sh
# add test decor near world origin
demo_add_decor

# remove test decor
demo_remove_decor
```

# ui

```sh
# show npc tracking ui
demo_npc_ui npc:rob

# log speech to console
demo_log_speech &
say Hello! rob
```

# npc interaction

```sh
spawn abe at:$( pick 1 ) as:robot-0
demo_back_off kate
```

# batch

```sh
# spawn an npc on every doable point
demo_spawn_many
```
