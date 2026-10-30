# Lighting

Three things light the World: the player's light, room lights, and each npc's own exposure.

## Player light (visibility sweep)

`service/player-light.ts` answers "can the player see this?" once per frame instead of per fragment.

- **A compute pass** (`Fn(...)().compute(lightAngles)`) sweeps `lightAngles` directions from the player. It writes the distance to the nearest occluder into a polar table, an `attributeArray` storage buffer.
- `<PlayerLight>` in `WorldView` dispatches it from a `useFrame(..., -2)`, so it lands before the render.
- **Materials read one entry** of that table:
  ```
  v = positionWorld.xz - lightXZ;  lit = |v| <= table[angleOf(v)]
  ```
- Two neighbouring angles are sampled and their *lit/unlit results* blended. Blending the distances instead would put a shadow edge where neither surface is.
- It reaches `lightRadius` metres, fading over its last `edgeFalloffShare`. What is not ahead of them, in a cone `coneHalfDeg` either side, loses `theme.lights.cone` of it.

**Occluders**
- Every wall segment: `gmsData.byKey[gmKey].wallSegs`, transformed to world on map change by `syncWalls`.
- The **closed** part of each door. It is derived in-shader from the door's `src`/`dst`, `gapAtHighLambda` and live `openRatio`, mirroring `Doors`' own `inGap` test.
- Windows are excluded on purpose: light passes through glass.
- Except HULL windows (`meta.hull`). Their centre line `seg` joins the walls, so nothing beyond the hull is lit. A CURVED one (`meta.curved`) has an AABB `seg` cutting across its bay, so `curvedMidline` follows its arc instead.

**The table is created once** and never rebuilt, so materials reading it survive a map change. Only the occluder buffers are refilled, and nothing but the sweep reads those. Nor is it rebuilt on hmr (`reset: { playerLight: false }`), so a change to its shader needs a page reload.

**Opting a material in** is one line: `m.colorNode = w.view.playerLight.applyLight(node)`, or `applyLightRgba` where the colour carries alpha.
- Unlit fragments are tinted towards black.
- A `strength` of `0` is exactly identity, so wrapping is unconditional. It is `0` with no player, or on a WebGL fallback backend, which has no real compute.

**A surface turned away takes less.**
- `applyLight` accepts a unit outward XZ normal, cut at edge-on. Obstacle skirts pass one per instance.
- A FIGURE asks `litBody(normalWorld)` for the AMOUNT instead, `0`–`1`. It wraps round them half-Lambert, off a lamp hung in front of the player. Whoever stands on the light has no bearing from it, and the player always does.
- The lamp hangs off the player's own height (`originY`), so it stays above one lain on a top bunk.

## Room lights

Besides the rooms the player can see, a room is shown whilst it is lit (`service/fade-rooms`, `sync`).

- **Lit npcs light the room they stand in** (`w.e.litRooms`), two whilst in a doorway (`syncLitRoom`). `w.e.setNpcLit` lights one or puts them out, from their menu (`PickMenu`) or the speech menu. Never the player.
- The World menu's toggle shows lit npcs' rooms or not (`w.view.setLitNpcsEnabled`, the `litNpcsEnabled` uniform).
- **A room lit by hand** (`w.e.setRoomLit`, `handLitRooms`) is shown whatever the player sees, and whether lit npcs are. `clearHandLitRooms` puts them all out. A map change empties them, a `grKey` meaning nothing to the next map.

## Npc exposure

An npc's colour is their skin times their exposure, which is ADDED up (`exposure` in `service/npc-material.ts`).

- **Ambient**: `npcMaterialConfig.ambient` out of the light (`ambientInSight` in `sight` mode), at least `theme.npcs.ambient`.
- **The player's light**: `litBody`, taking what the ambient leaves.
- **Lit**: `litAmbient` more whilst lit (`setNpcLit`). A lit npc also keeps their colour as their room fades.
- **In the player's room**: `theme.npcs.sameRoom` more, eased in and out over `sameRoomSecs` as either changes room. Each npc's `roomLit` uniform is eased in `NpcAnimation.tickRoomLit`, against `w.npc.playerRoom`, which `syncNpcRoomSlots` sets.
- Then flat-shaded from above (`faceShade`), and scaled by the npc brightness slider (`dimNode`). A tint would be capped at a 0.4 swing by `unlitTint`.
- `ambient`, `sameRoom` and `dim` are uniforms shared by every npc, set with the theme (`w.npc.setAmbient`) or the slider (`setBrightness`).
