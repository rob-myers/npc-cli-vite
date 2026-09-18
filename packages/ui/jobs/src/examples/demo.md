
# dynamic decor

```sh
# add test decor near world origin
demo_add_decor

# remove test decor
demo_remove_decor
```

# UI

```sh
# show npc tracking ui
demo_npc_ui npc:rob

# log speech to console
demo_log_speech &
say Hello! rob
```

# debug

```sh
# show rob's corners (continually)
demo_corners npc:rob

# show local boundary near rob (once)
demo_boundary npc:rob

# log agent params to tty
demo_fold npc:rob
```

# npc interaction

```sh
spawn abe at:$( pick 1 ) as:robot-0
demo_lean_back npc:abe
```

# batch

```sh
# spawn an npc on every doable point
demo_spawn_many
```
