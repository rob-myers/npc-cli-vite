# Engagements

What happens when one npc shoots another: how a shot ends, what a hit does, and how a shooter targets someone.
The ONLY doc for it. Carrying, raising and aiming the phaser are in `docs/inventory.md`.

| file | what |
| --- | --- |
| `ui/world/src/components/Phasers.tsx` | a shot: `shoot` decides it as it locks on, `strike` lands it |
| `ui/world/src/service/phaser-beam.ts` | where a part is (`bodyPartPoint`), and where the beam ends |
| `ui/world/src/components/NPCs.tsx` | `w.npc.hit` |
| `ui/world/src/components/npc-animation.ts` | hurt clips (`setHurt`, `hitDown`), the dead (`holdStill`) |
| `ui/world/src/components/npc-flinch.ts` | a jolt from a shot, and a hit's held lean (`flinch`, `tickFlinch`) |
| `ui/world/src/components/npc-clutch.ts` | a hand on the wound (`takeClutch`, `tickClutch`) |
| `ui/world/src/components/NpcGhost.tsx` | ghost: a dot screen, `w.npcGhost` |
| `ui/world/src/components/NpcArmour.tsx`, `service/armour.ts` | armour: ricochet and sparks, `w.npcArmour` |
| `ui/world/src/components/NpcFocus.tsx` | who targets whom, `w.npcFocus` |
| `ui/world/src/service/aim-target.ts` | whom a ray meets, and where (`npcOnRay`) |
| `ui/world/src/const.npc.ts` | `hitConfig` (hit clips), `ghostConfig`, `armourConfig`, `flinchConfig`, `hitFlinchConfig`, `clutchConfig` |

## How a shot ends

A shot's outcome is decided as its beam starts to lock on (`w.phasers.shoot`), and takes effect as the beam arrives
(`strike`), a frame or two later (`fadeSecs / lockRate`). It emits `npc-shot` (`by`, `npcKey`, `part`, `outcome`).
Locking on, it emits `phaser-fired` (`by`), as `fireAlong` does a shot at no one. jsh `sounds` plays both: see `docs/audio.md`.

| outcome | the beam | effect |
| --- | --- | --- |
| `hit` | lands on the part | see [What a hit does](#what-a-hit-does): they recover after |
| `down` | lands on the part | a hit that puts them down, collapsed or pacified |
| `ghost` | passes through them, once they are a dot screen | see [Ghost](#ghost) |
| `armour` | lands where aimed, as a hit does | see [Armour](#armour) |
| `kill` | lands on the part | a hit that leaves them dead: see [Kill](#kill) |

- **Who decides:** the player's bar's debug badge (`w.debug.forceShot`), `hit` by default.
- **The badge** shows on the phaser slot whilst **phaser** is ticked under **debug** in the World menu's **hud** select
  (`w.debug.hudDebugShown`, persisted per World). A click cycles it through `hit`, `down`, `ghost`, `armour` and `kill`. Unticking it
  resets it to `hit`.
- **A shot whose line meets no part of them**, from the muzzle through the dot, has no outcome and sends no `npc-shot`.
  It passes there, e.g. they moved since it was aimed.
- **A shot passing them** runs on to the wall beyond: one raycast from the target along the shot, found by `wallBeyond`
  within `passMax` metres. Until that returns it runs `passStub` past them. It meets the floor first if it is heading down.
- **Whom it meets beyond** (`passOn`): those within reach of its target, in turn along its line, short of that wall,
  by the box test targeting makes (`npcOnRay`). Each takes the badge's outcome, else `hit`. A ghost, or one already,
  passes it on, kept a ghost. The first that is not stops it, and is landed on (`shot.beyond`). It waits, unseen,
  until these are found, and every ghost among them is one (`shotWaits`).
- The player hears how a shot of theirs that did not hit ended (`w.hud.say`): `ghost` or `armour`.

### Ghost

They become a ghost, and the shot passes through them (`w.npcGhost`, `ghostConfig` in `const.npc`).

- As the shot locks on (`shoot`, `ghost`), their body becomes a dot screen over `inSecs`, its dots fixed on the
  screen (`dots`, as `dotScreen` in `extra-fx`). It is the npc's `dotScreen` uniform, which leaves their label and
  outline be.
- The shot waits, unseen, until they are a ghost (`isGhosting`), then passes through them, as one aimed beside them
  would (`shot.through`, `shot.past`): on to whom it meets beyond (`passOn`), else the wall. No clip plays, but
  `npc-shot` is emitted.
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

As a beam reaches its target, and no shield or obstacle stops it, a `hit`, `down` or `kill` outcome has `w.npc.hit` play a clip on them. The clip depends on the part
locked on to, and on whether they stand, sit or lie (`hitConfig` in `const.npc`). It emits `npc-hit`.

| part | stood | sat / lain |
| --- | --- | --- |
| head | `pain_head` | `{sit,lie}_pain_head` |
| chest, stomach, hips | `pain_high` | `{sit,lie}_pain_high` |
| an arm or leg | `pain_{arm,leg}_{left,right}` | `{sit,lie}_pain_low` |

Its pain clip plays once. After a `hit` they go back to rest, or to what they were in. After a `down` (`hitConfig.next`):

| part | after |
| --- | --- |
| head | `pacified` (or `{sit,lie}_pacified`) loops |
| body, stood | `collapse` plays instead of `pain_high` (`hitConfig.sink`), then `collapsed` loops: sat on the floor, slumped, breathing hard |
| body sat or lain, or a limb | back to rest: `breathe`, `sit` or `lie` |

- A head shot's clip ends slumped, so goes straight on.
- `collapse` (1.65s) is a stunned sway, then the left knee gives and they sink where they stand. It ends on `collapsed`'s
  first frame, so goes straight on. Their eyes are `scared` from then until released.
- A hurt clip fades in over `hitConfig.fadeInSecs`, so its first jolt reads.
- Collapsed, the right forearm lies across the lap, so a gun in hand stays clear of others' feet.
- Pacified or collapsed lasts until released: `pose npc-0 as:breathe`, or `as:sit` / `as:lie`.
- Whilst hurt (`anim.hurt`) they can do nothing. A move under way is stopped (it rejects with `hit`), their phaser is
  lowered, and `move`, `look` and arming are refused.
- A shove (`w.e.move`'s `shove`, e.g. jsh `sidestep`) still moves one pacified, or one collapsed. Collapsed, they
  scoot back-first in `collapsed_drag` (`anim.dragged`), at `dragConfig.speed`, turning as they go.
- Pain on someone already pacified or collapsed leaves them as they were after.
  A stood pain clip never plays on one collapsed (`hitDown`), a head shot's included: they stay down, jolted, a hand on
  the new wound.
  A head shot on someone pacified has no effect, nor does the label, or no part.
- One lock hits once. Hits are not mirrored over the network.

### Where it lands

A hit reacts to its point and its way (`w.npc.hit`'s `impact`, from `strike`).

- **A jolt.** The struck part, and the bones it hangs from, turn away from the shot (`flinch` with `hitFlinchConfig`).
  Whilst pacified or collapsed they stay turned `hold` of the way. Released, it eases out.
- **A hand on the wound** (`npc-clutch.ts`, `clutchConfig`). The left hand, or the right for a left-arm wound, reaches
  for where it landed, held in that bone's frame (`clutch.wound`), by `reachTo`.
  - On the head or torso (`coreParts`) it goes on the front, or the front half of the side towards the hand, whichever
    is nearer the wound, never the back. A side point within `sideMin` of the shoulder takes the front instead, else the
    arm folds up. So a shot in the back is held at the flank or front, and one behind the head at the temple.
  - The face is chosen once a wound (`clutch.face`), else it could flip mid-reach as they move.
  - On a limb, the palm goes on the side of the bone it reaches without crossing the body, leaning to the front.
  - The palm rests `palm` off the surface, the hand's half-thickness, as the forearm lies along it. On the head,
    met end-on, `palmHead`.
  - It runs last each tick, after the flinch and the stance, so the hand meets the wound where they leave it.
  - It crosses their middle by `cross` at most. A point across the torso, up to just over its top, goes onto the
    front of the chest's or stomach's box (`bodyPart`). So a wound on the other arm is clutched on the chest beside it.
  - The elbow heads in front of the chest as far as the hand crosses their middle (`elbowWay`, `reachTo`'s
    `elbowTo`), so the arm crosses in front of the body. A hand on its own side has the elbow out beside them, unless
    it is raised, e.g. at the temple, which brings the elbow forwards.
  - Only within reach, e.g. not a shin whilst stood. It stays `lingerSecs` after they recover, or are released,
    unless they move or the arm takes a pose. It eases in and out over `easeSecs`.
- Their body faces `-z` in its bones' frames, turned by `npc.rotation.y`, so ahead is `(-sin, -cos)`. Their group is not turned.

### Kill

A `kill` holds them still once its clip ends (`anim.dead`, `holdStill`).

- Stood, they fall dead the way the shot pushes, held on its last frame (`hitConfig.die`, by the shot's way in their own
  frame): shot from in front, `die_back` onto their back, arms a little out, the head about 1m behind where they stood;
  else `die_forward`, reaching to catch themselves, onto their front, the head about 1m ahead.
- Each death plays mirrored half the time (`mirroredClips`, made at load: see Mirrored clips in `docs/blockbench.md`), at a
  random rate within `hitConfig.dieRate`. The hurt clock runs at that rate too, so the fall's turn and hold keep pace.
- Falling, they leave the crowd (`startFall`: their agent goes, their physics body stays). Each tick the npc moves as far
  as the clip has carried their hips, and their root goes back as far (`tickFall`), so their shadow and corpse are where
  their body is. Released, they are placed back on the navmesh with an agent.
- They need `hitConfig.lieWidth` either side. A wall or obstacle nearer slides them that far off it as they fall
  (`roomToLie`, by `npc.roomAhead`, measured whilst they still have an agent).
- Sat, lain or already collapsed, their pose freezes (`hitConfig.dead`, paused at `deadSecs`).
- Eyes shut, no breath, no hand on the wound, no lean.
- A shove does not move them, nor a drag. A shot only jolts them.
- `npc-hurt` carries `dead`. `pose npc-0 as:breathe` revives them, for now.
- A fall must fit (`fitDeath`, `fitFall`, `fallFits`).
  - Clear floor for `hitConfig.lieLength` along its way (`npc.roomAhead` with `openDoorsFilter`: a shut door is a wall).
  - No one in their room in that strip, `othersWidth` either side, nor any corpse's hull across it (`stripClear`,
    `bodyCrosses`). That is narrower than `lieWidth`, so bodies may overlap a little.
  - The shot's way is tried first, turned to fall along the shot (`alongShot`) and then by each of `fitTurns`, then the
    other way at their own facing.
  - The turn and any slide are done by `fitBy` of the clip (`tickFall`), before their body reaches out into a wall.
  - A corpse's physics body goes where it lies, so a doorway it lies in is not clear and its door stays open.
- **Staggering.** If none fits, stood, they look for a spot that does along the shot, give or take 45°, within
  `staggerBy` (`staggerSpot`), with no one on the way there.
  - Behind them, they walk back to it, then fall (`w.e.takeHit`, which the phaser calls). Further hits are ignored
    meanwhile (`anim.staggering`), and a move that stops them short has them fall where they are.
  - Ahead of them, the fall slides them there instead, hidden by `die_forward`'s stumble (`startFall`'s `slide`).
- If no spot will do, they fall clear of corpses alone, over the living, who make way (`fitFall`'s `others`). Else clear
  of walls alone, onto whoever is there. Only with walls all round do they collapse where they stand (`hitConfig.sink`),
  held on its last frame. They then have no corpse body to step over.
- **Making way.** Whoever living stands where a body will lie steps out of its strip, quickly, to the nearer side
  (`anim.inTheWay`, `w.e.makeWayFor`), far enough that it passes beside them. Never the player, whose moves are their own.
  One who cannot move, e.g. hard pinned or hurt, stays put.

### Walking over a corpse

Others step over a fallen corpse, or onto it (`npc-over-body.ts`, `hitConfig.overBody`).

- **Its body.** Once its die clip is held, a corpse keeps where it lies (`fall.body`).
  - Its footprint is a convex hull of its parts' boxes, head to shins, arms included.
  - Its height `top` is its torso's, since the big head would have them stand high on it.
  - Its height ramps up over `ramp` from the hull's edge.
- **Its sensor.** A rect round the hull, `margin` wider, is posted to the physics worker as `corpse-{npcKey}`
  (`postCorpseCollider`).
  - Its `enter-collider` and `exit-collider` carry `meta.corpse`, and fill a walker's `overBody.on`.
  - It goes when they are revived or removed (`removeCorpseCollider`). That fires no exits, so whoever was on it is
    let off directly.
  - A physics rebuild loses it, so `w.npc.syncCorpseColliders` posts each again.
- **Feet.** Whilst `on` holds a corpse, each foot lifts so the middle of its sole clears the body under it by `clear`
  (`footLift`).
  - The knee bends to lift it: the thigh forward, the shin back twice as far, the foot level again. Their hips stay.
  - With both feet on it, their root rises towards the lower foot's lift, at `speed` either way. So they stand on it.
  - It runs after the stance, before the flinch, writing over what the pose left and putting it back next tick.
- **A jolt.** A foot planted on a body, as its pose has it, after not, jolts the corpse by its nearest part
  (`flinch` with `stepFlinchConfig`, pushed down).

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
  live aim. The player's alone. None is drawn where nothing stops it (`what: "nothing"`), e.g. out of a hull window.
- **Aiming.** Raised, Space held aims in earnest (`w.phasers.steady`, `isSteadied`): the left hand steadies the gun,
  and the view extends along its line to the first wall or door (a far look). Raised alone, the view keeps the look's own framing.
- `m` fires whilst raised, aiming or not (`fire`, from `w.player.releaseCharge`), so a click still picks: locked on the part the dot is on by `w.phasers.arm`, as every shot is, landing where the dot
  is. That point is held in the part's bone frame (the target's `local`, read by `targetPoint`), so it moves with
  them.
- As it locks on (`shoot`, `meetPart`), the line from the muzzle tip through the dot is tested against each hit
  region's bone, by the box round what it moves most (`partOnRay` in `phaser-beam.ts`). The nearest met is the part
  hit, and its point: a forearm in the way takes it. Meeting none, it has no outcome, and runs on through the dot to
  whom it meets beyond, else the wall. Only a shot aimed from the dot is tested: jsh `shoot:kate part:hips` is not.
- With no one met, it fires along the line (A shot at no one), at the dot's end if it was cast
  along this aim. The phaser stays raised, and so does the targeting. Space with the phaser lowered is a far look instead: see `docs/camera.md`.
- **Charging.** Raised, `m` held charges the shot (`w.phasers.charge`), full after `chargeSecs`, and let go fires
  it (`w.player.releaseCharge`). The shot takes the charge (`takeCharge`, in `arm` and `fireAlong`): `fireCharge`
  widens and brightens its beam, and `phaser-fired` carries it as `charge`. A tap fires at once, near `0`.
  - Charging, the gun brightens with the beam's colour and shakes (`glowOf`, the `phaserCharge` attribute).
  - `e` whilst charging cancels it (`cancelCharge`): it sputters out over `coolSecs`, the phaser left raised, and
    none charges meanwhile. Focus leaving the World cancels too.
  - On touch, raised, hold a finger anywhere, then put a second down at least `fireTouchDelayMs` later: it charges
    where they face, without turning them, and letting it go fires. Letting go of the first cancels (`onFireTouch`). The camera ignores both
    meanwhile, and a long press opens no menu whilst armed.
  - It has no effect on the outcome yet.
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
- **A laser** gives an npc the player's laser dot (`showsDot`): a target icon in their menu (`PickMenu`, joined to
  "phaser") or "sight" in their speech menu, disabled without a phaser. Or jsh `phaser kate --laser`
  (`laser:false` takes it). Theirs then targets whilst raised, and stays after firing, as the player's does
  (`w.npcFocus.setLaser`, `lasers`). It is not saved.

**Psi** focuses on someone to act on them: see `docs/psi.md`.
