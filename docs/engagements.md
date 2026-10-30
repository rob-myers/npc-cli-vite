# Engagements

What happens when one npc shoots another: how a shot ends, what a hit does, and how a shooter targets someone.
The ONLY doc for it. Carrying, raising and aiming the phaser are in `docs/inventory.md`.

| file | what |
| --- | --- |
| `ui/world/src/components/Phasers.tsx` | a shot: `shoot` decides it as it locks on, `strike` lands it |
| `ui/world/src/service/phaser-beam.ts` | where a part is (`bodyPartPoint`), and where the beam ends |
| `ui/world/src/components/NPCs.tsx` | `w.npc.hit` |
| `ui/world/src/components/npc-animation.ts` | hurt clips (`setHurt`), armour's flinch (`flinch`) |
| `ui/world/src/components/NpcGhost.tsx` | ghost: a dot screen, `w.npcGhost` |
| `ui/world/src/components/NpcArmour.tsx`, `service/armour.ts` | armour: ricochet and sparks, `w.npcArmour` |
| `ui/world/src/components/NpcFocus.tsx` | who targets whom, `w.npcFocus` |
| `ui/world/src/service/aim-target.ts` | whom a ray meets, and where (`npcOnRay`) |
| `ui/world/src/const.npc.ts` | `hitConfig` (hit clips), `ghostConfig`, `armourConfig`, `flinchConfig` |

## How a shot ends

A shot's outcome is decided as its beam starts to lock on (`w.phasers.shoot`), and takes effect as the beam arrives
(`strike`), a frame or two later (`fadeSecs / lockRate`). It emits `npc-shot` (`by`, `npcKey`, `part`, `outcome`).

| outcome | the beam | effect |
| --- | --- | --- |
| `hit` | lands on the part | see [What a hit does](#what-a-hit-does) |
| `ghost` | passes through them, once they are a dot screen | see [Ghost](#ghost) |
| `armour` | lands where aimed, as a hit does | see [Armour](#armour) |

- **Who decides:** the player's bar's debug badge (`w.debug.forceShot`), `hit` by default.
- **The badge** shows on the phaser slot whilst the World menu's debug **hud debug** is on (persisted per World). A
  click cycles it through `hit`, `ghost` and `armour`. Turning hud debug off resets it to `hit`.
- **A shot whose line meets no part of them**, from the muzzle through the dot, has no outcome and sends no `npc-shot`.
  It passes there, e.g. they moved since it was aimed.
- **A shot passing them** runs on to the wall beyond: one raycast from the target along the shot, found by `wallBeyond`
  within `passMax` metres. Until that returns it runs `passStub` past them. It meets the floor first if it is heading down.
- The player hears how a shot of theirs that did not hit ended (`w.hud.say`): `ghost` or `armour`.

### Ghost

They become a ghost, and the shot passes through them (`w.npcGhost`, `ghostConfig` in `const.npc`).

- As the shot locks on (`shoot`, `ghost`), their body becomes a dot screen over `inSecs`, its dots fixed on the
  screen (`dots`, as `dotScreen` in `extra-fx`). It is the npc's `dotScreen` uniform, which leaves their label and
  outline be.
- The shot waits, unseen, until they are a ghost (`isGhosting`), then passes through them to the wall beyond, as one
  aimed beside them would (`shot.through`, `shot.past`). No clip plays, but `npc-shot` is emitted.
- Meanwhile no phaser targets them (`syncTarget`): its dot passes through them to the wall, or whoever is behind.
- They stay so `holdSecs` after it strikes, else `missSecs` after it locked on, then come back over `outSecs`.

### Armour

The shot glances off them (`w.npcArmour`, `armourConfig`).

- A ricochet streak leaves where it landed, mirrored about the face of the part it met, with a spray of sparks off
  that face. A shot at a part's middle takes the face it enters by.
- They flinch: the struck part, and each bone it hangs from by `falloff` less, turns away from the shot about its
  joint, easing back over `flinchConfig.secs`. The hips and legs stay, so the feet do.

### A shot at no one

Fired with no one targeted (`w.phasers.fireAlong`), a shot runs straight along the aim. Npcs are ignored.

- It is a `FreeShot` beam target, a point rather than an npc. The fades are an npc shot's.
- Its end keeps its length along the live aim (`freeEndOf`), as the dot does. So a strafe sweeps it along the wall.
- Once the arm is up, one cast looks along the aim (`castAlong`, over `endsAlong`), from the muzzle's height:
  stood or crouched `headY - gunBelowHead`, sat or lain the tip's. So a crouched shot meets lower obstacles.
- Tilted (`tilt`), it slopes: `y + d·tan(pitch)` at `d` metres along the ground.
- It ends on the first of these: a wall or closed door, the floor (tilted down) or the ceiling (`wallHeight`, tilted
  up), an obstacle it meets at its height (in at a side, or down through its top or up through its underside), or a
  shield it can't pass (which glows). Else it runs `alongMax` metres, a geomorph's width. Its far end may be off the map.
- Struck, it emits `phaser-struck` (`by`, `at`, `what`: `wall`, `door`, `floor`, `ceiling`, `obstacle`, `shield` or
  `nothing`).
- Not fired within `fireSecs`, e.g. drawn in throughout, it is given up.

## What a hit does

**Obstacles.** The beam's cast runs from the muzzle at full aim to the part (`arm.sight`). Each tick it stops where
it first meets one: at its side, or down through its top or up through its underside (`acrossStop`). Nothing within
`partDepth` of the part's middle stops it, e.g. a thigh on its seat. Stopped, it never lands.

As a beam reaches its target, and no shield or obstacle stops it, a `hit` outcome has `w.npc.hit` play a clip on them. The clip depends on the part
locked on to, and on whether they stand, sit or lie (`hitConfig` in `const.npc`). It emits `npc-hit`.

| part | stood | sat / lain |
| --- | --- | --- |
| head | `pain_head` | `{sit,lie}_pain_head` |
| chest, stomach, hips | `pain_high` | `{sit,lie}_pain_high` |
| an arm or leg | `pain_{arm,leg}_{left,right}` | `{sit,lie}_pain_low` |

Its pain clip plays once, then (`hitConfig.next`):

| part | after |
| --- | --- |
| head | `pacified` (or `{sit,lie}_pacified`) loops |
| body, stood | `collapsed` loops: sat on the floor, slumped, breathing hard |
| body sat or lain, or a limb | back to rest: `breathe`, `sit` or `lie` |

- A head shot's clip ends slumped, so goes straight on. `pain_high` fades into `collapsed` over `pacifyFadeSecs`.
- Collapsed, the right forearm lies across the lap, so a gun in hand stays clear of others' feet.
- Pacified or collapsed lasts until released: `pose npc-0 as:breathe`, or `as:sit` / `as:lie`.
- Whilst hurt (`anim.hurt`) they can do nothing. A move under way is stopped (it rejects with `hit`), their phaser is
  lowered, and `move`, `look` and arming are refused.
- Pain on someone already pacified or collapsed leaves them as they were after, though a head shot pacifies one collapsed.
  A head shot on someone pacified has no effect, nor does the label, or no part.
- One lock hits once. Hits are not mirrored over the network.

## Targeting

`NpcFocus` (`w.npcFocus`) holds who targets whom. An npc's phaser shows as a red dot over its target's head, several
side by side. The player's, and any with a laser, has its laser dot on them instead: pulsing whilst on whom it meets (`laser-pulse` in `world.css`). Psi shows no mark.

**The phaser.** Whilst the player's phaser is raised it targets (`w.npcFocus.target`, on its `phasers` event). So
does one with a laser.

- A cast runs along its aim, returning where a shot at no one would land, and the rooms it passes through. Every
  aim due one is cast in a single worker request (`syncEnds`, over `w.phasers.endsAlong` and `w.e.raycasts`). One
  batch runs at a time, and again only once the muzzle has moved `castMovedM` (1mm), the
  aim turned or tilted `castTurnedRad`, or a door or shield changed (`recast`). So a still aim casts no more, and a
  frame is asked for only when its end changes: the World may rest.
- The target is the nearest npc in those rooms, through doors and windows alike, whose parts the live aim's ray meets (`npcOnRay` in
  `service/aim-target.ts`), short of where the cast stopped, or within `againstM` past it. One it passes over or
  beside is not targeted, so whoever is behind them may be. It is found each frame on the main thread
  (`syncTarget`), so a strafe or `r` sweeps it. A wall between is never crossed.
- **Height.** The aim's ray (`w.phasers.aimRay`) starts at the muzzle, so it follows stand, half crouch and full
  crouch. jsh `phaser rob tilt:-1` tilts anyone a detent up or down (`tilt`): −8°, level, +8° (`tiltRad`). The arm
  pitches to suit, easing over `tiltSecs`, and aims fully along it past `pitchFullRad`. Lowering levels it. The
  player has no key for it: detents were hard to aim with.
- On someone, the red dot pulses, and is where that ray meets their parts (`placeOn`, the entry's `met`), by the same box test
  a shot makes (`partOnRay`), each frame. It culls first: missing a cylinder `cullRadius` about them in plan,
  nothing is tested, else only bones within reach of the ray's heights across them.
- With no one met, a small red dot marks where a shot at no one would land (`placeEnd`), drawn along the
  live aim. The player's alone.
- Space fires (`fire`): locked on the part the dot is on by `w.phasers.arm`, as every shot is, landing where the dot
  is. That point is held in the part's bone frame (the target's `local`, read by `targetPoint`), so it moves with
  them.
- As it locks on (`shoot`, `meetPart`), the line from the muzzle tip through the dot is tested against each hit
  region's bone, by the box round what it moves most (`partOnRay` in `phaser-beam.ts`). The nearest met is the part
  hit, and its point: a forearm in the way takes it. Meeting none, it has no outcome, and runs on through the dot to the
  wall beyond. Only a shot aimed from the dot is tested: jsh `shoot:kate part:hips` is not.
- With no one met, Space fires along the line (A shot at no one), at the dot's end if it was cast
  along this aim. The phaser stays raised, and so does the targeting. Space with the phaser lowered raises it.
- Anyone may target, through jsh: `phaser rob --target`, `tilt:1`, `--fire`, `--cancel`. An npc's ends when
  fired or cancelled, and shows a dot over whom it targets.
- **Decor** stops a shot, as an obstacle does: a quad, bar a switch or a keycard, e.g. a screen or a box on a
  table (`stopsShots`). Its box is the cuboid drawn. A shot ending on one reports `what: "decor"` and its
  `decorKey`, in `phaser-struck` too. So a box between hides whoever is behind it from a phaser's target.
- **Aiming at a part.** jsh `phaser kate at:rob part:leftarm` targets, and aims kate at the middle of that part
  (`w.phasers.aimAt`). Each tick she faces it, and her pitch eases to it in place of a detent (`pitchAt`, kept
  after). It is let go of once aimed (`aimedRad`, else `aimSecs`), and the command then ends. With `--held` it
  follows them until killed, a tilt, a cancel or lowering, and firing keeps her targeting. Either pauses with the
  World. The ray still decides what is met, so a forearm in front takes it. `shoot:` names a part with no ray at
  all.
- **A laser** gives an npc the player's laser dot (`showsDot`): "laser" in their speech menu or bubble, or jsh
  `phaser kate --laser` (`laser:false` takes it). Theirs then targets whilst raised, and stays after firing, as the
  player's does (`w.npcFocus.setLaser`, `lasers`). It is not saved.

**Psi** focuses on someone to act on them: see `docs/psi.md`.
