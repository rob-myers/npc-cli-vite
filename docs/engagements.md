# Engagements

What happens when one npc shoots another: how a shot ends, what a hit does, and how the player picks a part to
shoot. The ONLY doc for it. Carrying, raising and aiming the phaser are in `docs/inventory.md`.

| file | what |
| --- | --- |
| `ui/world/src/components/Phasers.tsx` | a shot: `shoot` decides it as it locks on, `strike` lands it |
| `ui/world/src/service/phaser-beam.ts` | where a part is (`bodyPartPoint`), and where the beam ends |
| `ui/world/src/components/NPCs.tsx` | `w.npc.hit`, `w.npc.dodge` |
| `ui/world/src/components/npc-animation.ts` | hurt and dodge clips: `setHurt`, `dodgeClipFor` |
| `ui/world/src/components/NpcShields.tsx`, `service/shield-pieces.ts` | a personal shield's pieces, `w.npcShields` |
| `ui/world/src/components/NpcFocus.tsx` | the player's choice of part, `w.npcFocus` |
| `ui/world/src/const.npc.ts` | `hitConfig` (hit clips, `dodgeClips`), `shieldConfig` |
| `cli/src/jsh/world/shots.ts` | jsh `shots`, the odds of each outcome |

## How a shot ends

A shot's outcome is decided as its beam starts to lock on (`w.phasers.shoot`), and takes effect as the beam arrives
(`strike`), about `fadeSecs` later. Either way it emits `npc-shot` (`by`, `npcKey`, `part`, `outcome`).

| outcome | the beam | effect |
| --- | --- | --- |
| `hit` | lands on the part | see [What a hit does](#what-a-hit-does) |
| `missed` | passes `missBy` to one side of the part | none |
| `dodged` | passes where the part was as it locked on | a dodge clip, from the lock (`w.npc.dodge`) |
| `shielded` | lands on the piece over the part | that piece lights and dissolves (`w.npcShields`) |

- **Who decides:** the player's bar's debug badge, else `w.e.shotResolver`, else every shot hits.
- **jsh `shots`** sets the resolver to odds, e.g. `shots missed:0.2 dodged:0.2 shielded:0.1`. `shots off` clears it.
- **The badge** shows on the phaser slot whilst the World menu's debug **hud debug** is on (persisted per World). A
  click cycles it through `auto`, `hit`, `missed`, `dodged` and `shielded`. Turning hud debug off resets it to `auto`.
- **A shot passing them** runs on to the wall beyond: one raycast from the target along the shot, found by `wallBeyond`
  within `passMax` metres. Until that returns it runs `passStub` past them. It meets the floor first if it is heading down.
- The player hears how a shot of theirs that did not hit ended (`w.hud.say`).
- **A miss** passes `missBy` from their middle, on the side of the part, so it never runs through them.
- **A dodge** plays one clip, once, as the beam locks on, over `dodgeFadeSecs`, through `anim.hurt` like a pain clip.
  - Every dodged shot aims through the middle of its part, and the clip takes that part off the line. Sat, an arm shot aims
    at the upper arm, which moves clear more often than the hand (`hitConfig.dodgeAim`).
  - `hitConfig.dodgeClips` gives each clip a weight, and per part a 24-character string: one character per 15 degrees
    of shooter bearing, from ahead round to their left, `1` where the clip clears that part's line. They were measured
    in Blockbench by raycasting, with the beam's tilt for that part and its width, around its arrival.
  - A dodged shot picks at random, by weight, among the clips of their posture whose character for the shooter's
    bearing is `1` (`anim.dodgeClipFor`, over pools built once). None, or hurt already, and the shot is a miss.
  - Lain, there is no dodging in bed: a dodged shot becomes a hit.
  - Stood, they turn to face the shot as they dodge (`hurt.faceTo`), so the bearing is ahead. The beam aims where the
    part will be once turned. Held to an aim they do not turn, and the shooter's bearing counts, as it always does sat.
- **A shield piece** is a helmet over the head, else a band round the part, sized from what its bone moves. A hex
  lattice spreads from the hit, holds, then dissolves cell by cell (`shieldConfig` in `const.npc`).

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

## Npc focus

With the phaser or psi raised, a click on someone focuses on them (`NpcFocus`, `w.npcFocus`), as does jsh
`focus target-0`. What it offers is from what is raised, both if both (`withPhaser`, `withPsi`):

- **The phaser**: their six parts, numbered first. These need the steps below: the turn and line of sight.
- **Psi**: one mark on their head, "Become". It needs no turn, no line of sight and no facing. Chosen, the player
  leaves their body for theirs (`w.spirit.start`, see `docs/spirit.md`).

jsh `focus` with neither raised raises the phaser. With the phaser (`aimPhaser`):

1. `aimAt` raises the phaser pointed at them (`arm`'s `toward`) and turns the player to them (at most `turnMaxMs`).
   Stood, they turn round. Sat, their head turns. Lain, they roll to the pose that reaches them, if one does.
2. It waits for the phaser to come up clear as they now stand, by a cast made there (`w.phasers.isClear`, at most
   `raiseMaxMs`).
3. Drawn in there, or stowed lain, or out of sight (a raycast is blocked), it ends with the phaser left raised.
   With psi too, only "Become" is offered.
4. It waits for the aim to land (`w.phasers.isAimed`: the arm within 3°, and no roll still fading in).
5. A dot is pinned on each part offered from its bone each frame, its label in a column to one side,
   joined by a line. A label keeps its side until its part is `sideSwitchPx` across their middle, so breathing
   does not flip it. The World does not pause: to take more time, slow it with the time scale (the menu's slider,
   jsh `timescale`). Only whilst paused, and any of it pokes past the canvas edge (`screenMargin`), does the view
   pan, by part of the overflow each frame (`keepInRate`).
6. A mark pressed, or its digit, shoots that part once, at one bone (`npcFocusConfig.bones`), or becomes them.
   Cancel, amber over their middle above every mark, does neither. A press on them again does nothing. A phaser left raised no longer points at them.

Whilst it runs:

- `cancel` ends it as Cancel does, at any stage. `focus` runs until it is over, and a kill (ctrl-c) cancels it.
- Only the marks and Cancel take the pointer, so the camera still moves.
- Escape pauses the World as ever, and leaves it open. Closed, the marks keep to their parts as they fade (`placedKey`).
- The player's moves are refused whilst it aims (`w.e.move` throws `focused`), held keys included, as a move would
  undo the turn. Once the marks are up they move again.

With the marks up:

- The phaser's marks hide whilst the player faces more than `maxOffAimRad` (15°) away, and come back as they face
  them again (`shown`). Sat or lain, it is the arm that must point at them (`w.phasers.aimOff`), or they are out of
  reach. "Become" stays. With nothing left to show, the overlay fades (`offAim`).
- Their room going unlit ends it as Cancel does, e.g. a door shut between them (`syncLit`). It is checked on
  `update-faded-rooms`, and as they enter a room. Out of sight in a lit room, it stays open.
- Lowering the phaser hides its marks, and lowering psi hides "Become". Once neither is raised it ends as Cancel
  does (`isLost`).
- Raising psi or the phaser whilst it is open focuses afresh, so its choices are offered too (`raisedAtOpen`). A
  phaser raised by hand then stays up after.
- A click on someone else replaces the focus with a fresh one. A click on them does nothing.

After it, the phaser is lowered (`arm`'s `once`, at most `onceSecs`), unless it was raised before the click, e.g. by `e`.
