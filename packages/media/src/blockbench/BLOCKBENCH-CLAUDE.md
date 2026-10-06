# Blockbench MCP Notes

## Critical: `manage_keyframes` does not work

The `manage_keyframes` MCP tool returns `"Successfully performed edit"` but does **not** actually modify keyframe values. Always use `risky_eval` to read or write keyframe data directly.

### Reading keyframes

```js
const sit = Animation.all.find(a => a.name === 'sit');
const anim = Object.values(sit.animators).find(a => a.name === 'rightarm');
anim.keyframes.filter(k => k.channel === 'rotation')
  .map(k => ({ time: k.time, x: k.get('x'), y: k.get('y'), z: k.get('z') }))
```

### Writing keyframes — always wrap in Undo

Plain `kf.set()` alone does not reliably update the viewport. Wrap every write in `Undo.initEdit` / `Undo.finishEdit`:

```js
const sit = Animation.all.find(a => a.name === 'sit');
sit.select();
Undo.initEdit({animations: [sit]});

const anim = Object.values(sit.animators).find(a => a.name === 'rightarm');
const kf = anim.keyframes.find(k => k.channel === 'rotation' && k.time === 0);
kf.set('x', 5); kf.set('y', -0.17); kf.set('z', 2);

Undo.finishEdit('description of change');
Animator.showDefaultPose(false);
Animator.preview();
Timeline.setTime(0);
```

### Refreshing the viewport after edits

```js
Animator.showDefaultPose(false);
Animator.preview();
Timeline.setTime(0);
```

**Do NOT call `Canvas.updateAll()`** — it resets the character to T-pose.  
**Do NOT call `Timeline.setTime(0, true)`** — the `true` flag also causes a T-pose reset.

### Propagating a pose across all keyframe times

When the user manually adjusts t=0, copy those values to t=1.25 and t=2.5 so the animation doesn't snap to stale old poses:

```js
const t0 = [kf_x, kf_y, kf_z];
setKf('rightarm', 'rotation', 1.25, ...t0);
setKf('rightarm', 'rotation', 2.5,  ...t0);
```

## Camera

- Character faces **-Z**. Camera at `[0, 10, -60]` → front view. Camera at `[0, 10, 60]` → back view (face not visible).
- Good isometric view showing face: `position: [-30, 30, -50]`, `target: [0, 8, 0]`.
- `set_camera_angle` affects the **live Blockbench viewport** the user sees — always restore to the agreed angle after diagnostic use.
- Calling `Animator.preview()` can cause the camera to drift — restore with `set_camera_angle` afterwards.

## Arm coordinate system (`thinner.more-anims.wip.bbmodel`)

Bones: `rightarm`, `leftarm`, `rightforearm`, `leftforearm`

### Upper arm (`rightarm` / `leftarm`)

- **x**: forward/backward swing. Positive = arm swings **forward**; negative = arm swings **backward**. Idle rest ≈ +5.
- **y**: minor twist (idle uses ±0.17). Rarely needs changing.
- **z**: lateral flare. Arms are **mirrored** so z behaves oppositely per side:
  - `rightarm` z positive → arm flares **outward** (away from body). z=90 = arm horizontal to the right.
  - `leftarm` z positive → arm swings **inward** (toward body center); z negative → outward.
  - Idle rest: `rightarm` z≈+2, `leftarm` z≈-2 (both slight outward).

### Forearm (`rightforearm` / `leftforearm`)

- **x**: elbow bend. Positive = forearm bends **forward** from elbow. x=9 (idle rest) = slight bend; x=65+ = strong forward bend placing hand well in front of body.
- **z**: lateral wrist rotation. For `leftforearm`, positive z rotates forearm **inward** toward body center.

#### Rotation order and the other channels (verified on `current.bbmodel`)

Mesh Euler order is `ZYX` and values are applied **unnegated** (`mesh.rotation.x` = keyframe x in radians).
So a bone's z applies first, about its own hanging axis (no visible effect on a straight-down bone),
then x, then y in the parent frame:

- Arm at x=90 (straight forward): **+y swings it toward -X** — inward for `rightarm`, outward for `leftarm`.
- `rightarm` z=90 → elbow at +X (outward); y alone on a hanging arm only twists it.
- **Position** channel is world-axis, no flip: +y up, **+z backward**, so a push forward is negative z.
- **Head**: +z tilts the top toward -X (character's left); **-x bows** forward, +x looks up.
- **Torso** (`stomach`/`chest`): **negative x leans forward** — `sit`'s slump is -4/-5. Arms and head are
  children of `chest`, so a lean pitches an outstretched arm at the floor unless its x is raised by as much.

### Legs and the floor

- Legs: +x swings forward; knees bend with negative x; feet +x = toes up.
- `skeleton-root` pivots at **y=24** (head height), so idle's root x sway 0→2.5 swings the feet ~1 unit
  along z — idle's leg rock is what cancels it. A pose with planted feet must zero the root rotation,
  else the whole figure drifts.
- Floor is the idle foot-cube bottom, **y ≈ 0.24**. Measure a foot with
  `new THREE.Box3().expandByObject(cube.mesh)` after `Animator.preview()`.
- The ankle sits ~2 units **ahead** of the hip, so swinging a leg forward *raises* the foot (14° → +0.8)
  whilst swinging it back barely lowers it. The boot is too short to tip-toe, so a split stance cannot
  ground both feet: use modest angles and split the residual via `skeleton-root` position y.

### Posing by search

Solving a contact pose (hand on temple) by hand is fiddly; grid-search it in Blockbench instead — set
the keyframe values, `Animator.preview()`, then read a point off the bone with
`group.mesh.localToWorld(new THREE.Vector3(...))` (offset from the bone origin; a forearm's tip is
`(-0.25, -6.07, -0.62)`). ~3000 samples run in a second or two.

### Creating an animation

```js
const anim = new Animation({name, loop: 'loop', length: 2.5, snapping: 24}).add(true);
anim.getBoneAnimator(Group.all.find(g => g.name === 'rightarm'))
  .addKeyframe({channel: 'rotation', time: 0, interpolation: 'catmullrom', data_points: [{x, y, z}]});
```

## influence (2.5s loop, catmullrom at 0 / 1.25 / 2.5)

Idle's root sway and breathing, leaning forward, right hand on the right temple, left arm outstretched,
left foot forward. t=1.25 is the push: deeper lean, arm rises and shoves forward, hand stays on the temple.

| Bone | channel | t=0 / t=2.5 | t=1.25 |
|------|---------|-------------|--------|
| stomach | rotation | [-8,0,0] | [-11,0,0] |
| chest | rotation | [-5,0,0] | [-6,0,0] |
| head | rotation | [-2,0,-6] | [-3,0,-8] |
| rightarm | rotation | [0,15,110] | [0,18,112] |
| rightforearm | rotation | [170,0,-50] | [172,0,-50] |
| leftarm | rotation | [104,-8,0] | [112,-8,0] |
| leftarm | position | [0,0,0] | [0,0.3,-0.4] |
| leftforearm | rotation | [6,0,0] | [0,0,0] |
| leftthigh / leftshin / leftfoot | rotation x | 14 / -5 / -9 | same |
| rightthigh / rightshin / rightfoot | rotation x | -9 / 0 / 9 | same |
| skeleton-root | position | [0,-0.19,1] | — |
| skeleton-root | rotation | 0 | 0 |

Stomach/chest position and leg z are idle's; the root rotation is zeroed and the legs pinned, so the
feet stay put (see *Legs and the floor*).

## psi / psi_avoid (2.5s loop)

`Psi`'s hand, the LEFT arm alone so the right is free for a phaser — played over that arm only, so no
legs or root. Hand at the temple: `psi` with the elbow out to the side (`leftarm` [110,35,0],
`leftforearm` [130,0,-8]), `psi_avoid` with it tucked in front (`leftarm` [112,0,20], `leftforearm`
[128,0,-20]) for when a neighbour is close. Both keep the small lean (stomach -8, chest -5, head -2).

## drop_left / pick_up_left / crouch_left

Mirrors of `drop`, `pick_up` and `crouch` for the other hand: left and right bones swapped, rotation
`y` and `z` and position `x` negated. Re-mirror after changing the originals.

## phaser_aim / phaser_aim_avoid (2.5s loop, catmullrom at 0 / 1.25 / 2.5)

`Phasers`' phaser: a stance stood in at rest, and played over the upper body on the move. Root rotation
zeroed and the feet pinned flat (0.27 / 0.21), left foot forward. The right forearm is level and dead
ahead at t=0 (`along` `(0, 0, -1)`, its `+x` up), the arm's x rising with the lean as it breathes; the
left arm is idle's, free for psi. `phaser_aim_avoid` shares the legs, torso and head, the right forearm
raised beside the shoulder, muzzle up — solved from a target basis via `Euler.setFromQuaternion(q, 'ZYX')`.

| Bone | channel | t=0 / t=2.5 | t=1.25 |
|------|---------|-------------|--------|
| stomach / chest | rotation x | -1 / -1 | -2.5 / -2.5 |
| stomach / chest | position y | -0.1 / -0.1 | 0.1 / 0.2 |
| head | rotation x | 2 | 5 |
| rightarm | rotation | [92,0,0] | [95,0,0] |
| rightforearm | rotation | [0,90,0] | same |
| leftarm | rotation | [61,-40,0] | [64,-40,0] |
| leftforearm | rotation | [43,0,0] | same |
| leftthigh / leftshin / leftfoot | rotation x | 22 / -29.2 / 7.2 | 26.5 / -47.6 / 21.1 |
| rightthigh / rightshin / rightfoot | rotation x | 6.9 / -47.3 / 40.4 | 3.3 / -50.8 / 47.5 |
| skeleton-root | position | [0,-0.54,1.45] | [0,-0.79,0.55] |
| avoid: rightarm | rotation | [8,0,6] | [8,0,6] |
| avoid: rightforearm | rotation | [84.97,-72.01,88.98] | same |
| avoid: leftarm / leftforearm | rotation | [1,0,-6] / [118,0,12] | [2,0,-6] / [120,0,12] |

**The stance is balanced, and rocks.** As first keyed it stood over its front foot, the other trailing,
and leant 9°-14°. Now the feet keep that spacing but are planted either side of the hips (ankles `z`
-1.17 and 3.17 about the root's 1), the hips 0.5 lower to reach them; the torso leans 2° at the back of
the rock and 5° at the front, the head countering it and each arm's `x` raised by as much, so the gun
stays level. The root rocks 0.9 end to end about where it stood, sinking 0.25 as it goes forward.

The legs are SOLVED so both ankles stay put and both soles flat, keyed every fifth frame;
`phaser_aim_avoid` has the same root, legs, torso and head. Not hand-keyed: see *Clips keyed from code*.

Export from the rest pose: after any `Animator.preview()` run `Animator.showDefaultPose(true); Canvas.updateAllBones()`
first, else the glTF's nodes keep the pose.

## drop

Putting an item down on a table (`w.e.dropItem`), upper body only and a still pose — the game eases it
in and out. A lean (stomach -6, chest -4, head 4) with the right arm reaching forward and down to table
height (`rightarm` x 56, `rightforearm` x 8); the left arm is idle's (`leftarm` [5,0,-2], `leftforearm` x 9).

## pick_up

`drop`'s counterpart (`w.e.takeItem`), likewise a still upper-body pose: a deeper lean (stomach -9, chest
-7, head 3) and the right arm lower with the elbow bent to grasp (`rightarm` x 50, `rightforearm` x 28).

## crouch

Putting down on, or taking off, the FLOOR (`w.e.reachFor`): a still whole-body squat. Feet where they
rest, the root 8.5 down and 3 back, legs solved to them; the torso leans 60 (stomach and chest -30
each, head 40), the right arm hangs 22 forward of plumb so the hand touches the floor ahead, the left
rests on the knee. Keyed from code, recipe `crouch`.

## Clips keyed from code

`scripts/src/bins/gen-clip-keys.ts` re-keys clips whose motion is solved rather than posed. It writes the
keyframes into `current.bbmodel` AND bakes them into `current.gltf` as the exporter would (a key a
frame, `LINEAR`), so Blockbench need not be open. Each entry of its `clips` is a RECIPE: default
`params`, and `tracks(params)` returning one `Track` per bone channel — `turn` for a posed rotation,
`breathe(a, b)` for a value that swells with the cycle, `plantedLegs` for a root and legs solved so
both feet stay put (it throws if a leg cannot reach).

```sh
node scripts/src/bins/gen-clip-keys.ts                        # every recipe
node scripts/src/bins/gen-clip-keys.ts phaser_aim rock=0.6 drop=0.4
```

Recipes now: `sit` (`knee`), `crouch` (`down back lean reach`) and `phaser_aim` (`rock drop sink lean
breathe`, also keying `phaser_aim_avoid`). A clip new to the glTF is added to it. It appends to the glTF's buffer, so restore both files first — `git checkout`, or
re-export from Blockbench. Reload the project in Blockbench afterwards, else a save puts the old keys back.

## point / point_avoid

jsh `pose`'s pair, upper body only. Idle's legs, sway and left arm, so it reads as pointing, not a guard:
`point` leans a little (stomach -3, chest -2, head 5) with the right arm level and dead ahead
(`rightarm` x 95, `rightforearm` [0,90,0]); `point_avoid` stands as idle does, the right forearm raised
before the shoulder (`rightarm` [12,0,5], `rightforearm` [88.07,-57.53,86.74]: `along` `(0, 0.93, -0.37)`).

## walk / run — planted feet (legs and root solved, not hand-keyed)

The npc moves `1 / gait` metres per cycle (`gait` in `npc-animation.ts`: walk `1`, run `0.5`), i.e.
at 1/16 × `npcScale` (0.7) a stance foot must slide back **22.86 u/s** (walk) / **45.72 u/s** (run).
Legs, knees, feet (x only) and `skeleton-root` position y were solved by 2D IK from a foot path — heel
strike, flat, toe-off rocker, Hermite swing — with the root taken from a target stance-knee bend and
low-passed under the reach limit. Keys: 24 per cycle (12 was too coarse: the rockers sank the foot
up to 0.17). Stance speed checks within 0.5% (walk). Leg/knee position
channels were dropped, and run's root rotation `-2` moved onto `hips` x.

- Walk: left heel strikes at t=0, duty 0.5, heel strike toes-up 22°, toe-off −34°; bob −0.84…+0.15;
  stance knee −16…−35° (the long stride for these short legs needs the big heel/toe rockers). Leans
  from the hips: `hips` x −11 at contact / −9 passing, `chest` −2 / 0; head +4 / +2 so it tips
  down with the body; arms raised +10.5 / +7 over their original swing so they still hang.
- Run: left lands at t=0, duty 0.27; bob −0.87…−0.29; swing knee to −115°.
- Hand-tweaking one leg key breaks the plant — re-measure a foot's lowest vertex per sample.

## Sit animation — legs

Thighs level (`x` 90), knees bent 80° (`shin` x -80), feet `x` -12 at 0 / 2.5 and -7 at 1.25 so the
soles sit near flat and breathe — the `sit` recipe of *Clips keyed from code*. The legs are short: the
shin and foot hang 0.28m, so on any seat above that the feet dangle — one clip serves every seat height.

## Sit animation — arm position keyframes

Remove the arm y-lift (originally y=0.3 at t=1.25) — set all arm position keyframes to `[0, 0, 0]` so arms don't float during the breathing cycle.

### Sit animation — confirmed lap-resting pose (user-adjusted t=0)

As of latest edit, the user-set t=0 values are:

| Bone | x | y | z |
|------|---|---|---|
| rightarm | 5.2364 | 17.2613 | 3.5726 |
| leftarm | 4.8748 | -10.9991 | -6.0008 |
| rightforearm | 65 | 0 | 0 |
| leftforearm | 68.5313 | -13.1247 | 4.9988 |

These should be copied to t=1.25 and t=2.5 (no arm movement during breathing).

## Breathing: the head is on the end of the torso lever

Head and arms are children of `chest`, so torso *rotation* breathing (stomach/chest x → 0) is seen
mostly as the head pitching — `sit` inherits a 9° sway before its own nod. Options:
- **Counter the head**: `sit`'s head is now `x=5` at 0 / 2.5 and `0` at 1.25, no mid-cycle nod,
  so its world pitch swings 4°, not 14°.
- **Translate, mostly**: `lie` (catmullrom) lifts the belly first and most — stomach position z
  `-0.3` at 1.9 (local -z is world up under the 90° root; **local +x on the chest LOWERS its top**
  there) — then the ribcage, chest position z `-0.15` and rotation x `-2` at 2.2, arms z `+0.25` and
  flared `±1.5`. The head counters most of it (position z `+0.55`, rotation `+1.5`) but not all: a
  fully pinned head reads dead, so it keeps a `0.1` lift and half a degree of nod. Peak world rise:
  belly 0.29, sternum 0.53, head 0.1.

## Chest breathing (sit animation)

Target values (applied at t=0 and t=2.5; t=1.25 is the "inhale" peak):

| Bone | channel | t=0 / t=2.5 | t=1.25 |
|------|---------|-------------|--------|
| chest | rotation x | -5 | 0 |
| chest | position y | -0.15 | +0.05 |
| stomach | rotation x | -4 | 0 |
| stomach | position y | -0.12 | 0 |

## Animation list (`thinner.more-anims.wip.bbmodel`)

`idle`, `walk`, `run`, `sit`, `shuffle-back`, `lie`

## Bone hierarchy

`root` → `skeleton-root` → `hips` → `stomach` → `chest` → head, arms  
Arms: `rightarm` / `leftarm` → `rightforearm` / `leftforearm`  
Legs: `rightthigh` / `leftthigh` → `rightshin` / `leftshin` → `rightfoot` / `leftfoot`
