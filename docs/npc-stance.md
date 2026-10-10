# Npc stance

After a gait, an npc's feet stay roughly where they stopped. The ONLY doc for it.

| file | what |
| --- | --- |
| `ui/world/src/components/npc-stance.ts` | all of it: `takeStance`, `tickStance` |
| `ui/world/src/components/npc-animation.ts` | the hooks: `setPose` records, `tick` holds |
| `ui/world/src/const.npc.ts` | `stanceConfig`: the switch and the tuning |

## What it does

`idle` and `breathe` stand with the feet side by side. Without this, stopping mid-stride fades the
legs back to that, and the feet slide together.

With it, the feet are held where they were:

1. **Record.** `setPose` calls `takeStance` as a moving pose (`walk`, `run`, `backwards`) gives way
   to a standing one. It reads each ankle's place on the ground from the bones. The lower foot is
   the planted one. If both are down, it is the one ahead.
2. **Hold.** `tickStance` runs each frame after the mixer. The planted foot stays where it stopped.
   The other keeps `keep` of its distance from it.
3. **Solve.** Each leg is solved to reach its ankle: side on first, then tipped sideways about the
   hip. The foot keeps the pose's own tilt, so the sole stays flat.
4. **Hips.** They sink until the longer leg reaches. They also shift over the feet, so the legs do
   not slant.
5. **Let go.** Any pose that is not standing eases the hold out. When it ends, the pose's own legs
   and hips are written back. A sit or a lie ends it at once: they are elsewhere by then, and the
   hips easing back would slide them on the seat.

It is one mechanism. There is no code per gait or per direction: a strafe's sideways spread is held
the same way as a walk's stride.

## Settings

`stanceConfig` in `const.npc`. Lengths are in the model's own metres, which are world metres
divided by `npcScale`.

| key | meaning |
| --- | --- |
| `on` | `false` disables all of it |
| `keep` | the share kept of how far apart the feet were |
| `maxSplit` | the most that kept distance can be |
| `maxOff` | the furthest a foot is held from where the standing pose has it |
| `minOff` | feet nearer the pose's places than this are not held |
| `maxShift` | the furthest the hips move to stand over the feet |
| `maxLean` | the slant left to the legs once the hips have shifted |
| `level` | ankles within this of one another count as both down |
| `fadeSecs` | how long the hold takes to ease in or out |

## Why it is built this way

Each of these was a bug first.

- **The gait keeps playing as it fades out.** `setPose` crossfades over 0.3s, and the walk clip
  cycles on underneath. A foot target that follows the blended pose is dragged back by the walk,
  then pulled forward to its held place. So whilst easing in (`settling`), feet are eased from
  where they stopped on the ground, and the pose is not followed.
- **The standing poses stand with straight legs.** The ankle is 0.1% short of the leg's full
  length. Holding the feet apart is impossible unless the hips sink. That is what `sink` is for.
- **The standing poses stand further back.** `idle` has the hips about 11cm behind where `walk`
  has them. The body also slides on about 5cm after the pose changes, as the agent brakes. Feet
  held exactly in place end up behind the body, and both legs slant back. So the hips shift over
  the feet, and the feet make up what `maxShift` does not cover.
- **The hips move, so feet are placed on the ground.** `skeleton-root` rises, sways and pitches
  with the pose, and pivots at head height. A foot fixed relative to the hips slides across the
  floor. Positions are therefore in the npc's own frame, and the hips' pitch is undone.
- **A hold cut short is dropped, not rescaled.** Turning or walking off in the first frames ends
  the hold whilst its weight is near zero. Dividing by that weight to carry on made huge offsets,
  and the legs bent back to reach them.
- **The mixer only writes a bone whose value changed.** A still pose would leave our rotations in
  place for ever. `letGo` writes the pose's own back. `base` and `written` on each bone tell the
  pose's value from ours, as `UpperBone` does for the arms.

## Checking it

A hot reload is not enough. Live npcs keep their old stance data, and the result looks broken.
Remount the World after editing `npc-stance.ts`: saving `const.npc.ts` does it.

Measure rather than eyeball. Walk an npc a metre or two, and at the stop sample the foot bones'
world positions each frame. Good numbers, from ten stops across walk, run, strafe and backwards:

- the planted foot moves 1 to 3cm in the world after a walk or strafe stop
- both ankles end at the floor's height
- the knee never goes behind the line from hip to ankle
- once settled, the feet drift under 1cm with the breathing sway

Stopping from a run is rougher. Its stride is past `maxOff`, so the planted foot is pulled in by
up to about 9cm.

## Cost

About 2 microseconds per npc per frame whilst a stance is held, measured on one npc in a tight
loop. An npc with no stance to hold pays one boolean check. Nothing is allocated per frame, and no
world matrices are updated.
