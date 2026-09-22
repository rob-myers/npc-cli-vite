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

## psychic-attack (2.5s loop, catmullrom at 0 / 1.25 / 2.5)

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
| leftleg / leftknee / leftfoot | rotation x | 14 / -5 / -9 | same |
| rightleg / rightknee / rightfoot | rotation x | -9 / 0 / 9 | same |
| skeleton-root | position | [0,-0.19,1] | — |
| skeleton-root | rotation | 0 | 0 |

Stomach/chest position and leg z are idle's; the root rotation is zeroed and the legs pinned, so the
feet stay put (see *Legs and the floor*).

## walk / run — planted feet (legs and root solved, not hand-keyed)

The npc moves `1 / gait` metres per cycle (`gait` in `npc-animation.ts`: walk `1`, run `0.5`), i.e.
at 1/16 × `npcScale` (0.7) a stance foot must slide back **22.86 u/s** (walk) / **45.72 u/s** (run).
Legs, knees, feet (x only) and `skeleton-root` position y were solved by 2D IK from a foot path — heel
strike, flat, toe-off rocker, Hermite swing — with the root taken from a target stance-knee bend and
low-passed under the reach limit. Keys: 24 per cycle (12 was too coarse: the rockers sank the foot
up to 0.17). Stance speed checks within 0.5% (walk). Leg/knee position
channels were dropped, and run's root rotation `-2` moved onto `upperbody` x.

- Walk: left heel strikes at t=0, duty 0.5, heel strike toes-up 22°, toe-off −34°; bob −0.84…+0.15;
  stance knee −16…−35° (the long stride for these short legs needs the big heel/toe rockers). Leans
  from the hips: `upperbody` x −11 at contact / −9 passing, `chest` −2 / 0; head +4 / +2 so it tips
  down with the body; arms raised +10.5 / +7 over their original swing so they still hang.
- Run: left lands at t=0, duty 0.27; bob −0.87…−0.29; swing knee to −115°.
- Hand-tweaking one leg key breaks the plant — re-measure a foot's lowest vertex per sample.

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

`root` → `skeleton-root` → `upperbody` → `stomach` → `chest` → head, arms  
Arms: `rightarm` / `leftarm` → `rightforearm` / `leftforearm`  
Legs: `rightleg` / `leftleg` → `rightknee` / `leftknee` → `rightfoot` / `leftfoot`
