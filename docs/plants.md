# Plants

Every potted plant in a World is drawn by `<Plants>` (`components/Plants.tsx`): one instanced mesh, so one draw call however many there are.

- **A plant is a symbol instance.** Place `extra--025--plant seed=N` in a room or hull symbol. Its pot is the symbol's one obstacle, `obstacle plant`, which the navmesh keeps clear of as any other. All pots share that obstacle's one sprite.
- **`seed` picks its look.** An instance's `seed` reaches the pot's obstacle (`instantiateFlatSymbol`, kept by `createLayout`). Without one, its obstacle id is used.
- **Leaves are shaped in the shader.** The geometry's position holds which leaf, how far along it and which side, not where it is. A hash of the seed and the leaf sets its way round, tilt, length, width, droop, grey and whether it is drawn at all.
- **Leaves keep off the walkway.** On map load each plant gets a reach for 8 ways round its pot (`reachesOf`): as far as stays in its room and `clearance` (0.1m) off the navmesh, between 1.4 and 3 times its pot's radius. So they spread towards walls and furniture, and only a little towards where npcs walk.
- **It fades with its room** (`roomSlots`), is lit by the player's light, and is never picked: a click goes through to its pot or the floor.
