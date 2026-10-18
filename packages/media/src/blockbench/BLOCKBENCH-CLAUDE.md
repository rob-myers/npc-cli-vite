# Blockbench: Claude's notes

How Claude edits the npc model through the Blockbench MCP plugin, what the model is like, and how each
clip was made. Setup and the user's own tips are in `docs/blockbench.md`.

- The model is `current/current.bbmodel`. DEV reads `current/current.gltf`, exported from it.
- Production reads `current/current.glb`, written from the gltf by `gen-current-glb`: on each save in DEV, and on commit. A DEV page given `?glb` reads it too.
- A clip the game plays needs its key in `const.npc`'s `fromAnimationClipKey`.

## Working through the MCP

### Rules

- **`manage_keyframes` does not work.** It returns `"Successfully performed edit"` but changes nothing.
  Read and write keyframes with `risky_eval` instead.
- **Wrap every write in `Undo.initEdit` / `Undo.finishEdit`.** A plain `kf.set()` does not reliably update the viewport.
- **Never call `Canvas.updateAll()`, nor `Timeline.setTime(0, true)`.** Both reset the character to a T-pose.
- **Solve with ONE animation playing.** `Animator.preview()` adds every animation whose `playing` is set, so a
  solve run with another still playing lands on the sum. Clear `playing` on the rest first.
- **When the user adjusts t=0 by hand, copy it to the other keys**, e.g. t=1.25 and t=2.5, so the clip does
  not snap to stale poses.
- **Look through an offscreen view** (`create_offscreen_view`, then `set_camera_angle` with its `view`).
  `set_camera_angle` on the active view moves the camera the user sees. If that happens, put it back.
  `delete_offscreen_view` has failed with `onContextMenu is not defined`; an open view goes when the session ends.

### Reading and writing keyframes

```js
// read
const sit = Animation.all.find(a => a.name === 'sit');
const arm = Object.values(sit.animators).find(a => a.name === 'rightarm');
arm.keyframes.filter(k => k.channel === 'rotation')
  .map(k => ({ time: k.time, x: k.get('x'), y: k.get('y'), z: k.get('z') }));

// write
sit.select();
Undo.initEdit({ animations: [sit] });
const kf = arm.keyframes.find(k => k.channel === 'rotation' && k.time === 0);
kf.set('x', 5); kf.set('y', -0.17); kf.set('z', 2);
Undo.finishEdit('description of change');

// show it
Animator.showDefaultPose(false);
Animator.preview();
Timeline.setTime(0);
```

### Creating an animation

```js
const anim = new Animation({ name, loop: 'loop', length: 2.5, snapping: 24 }).add(true);
anim.getBoneAnimator(Group.all.find(g => g.name === 'rightarm'))
  .addKeyframe({ channel: 'rotation', time: 0, interpolation: 'catmullrom', data_points: [{ x, y, z }] });
```

### Posing by search

A contact pose, e.g. a hand on the temple, is fiddly by hand. Grid-search it instead:

1. Set the keyframe values.
2. `Animator.preview()`.
3. Read a point off a bone with `group.mesh.localToWorld(new THREE.Vector3(...))`, an offset from the bone's
   origin. A forearm's tip is `(-0.25, -6.07, -0.62)`, or `(0, -5.6, 0)` as the hit clips used.
4. Or bound a bone's cubes: `new THREE.Box3().expandByObject(cube.mesh)`.

About 3000 samples run in a second or two.

### Camera

- The character faces **-Z**. A camera at `[0, 10, -60]` sees the front, at `[0, 10, 60]` the back.
- A good isometric view showing the face: `position: [-30, 30, -50]`, `target: [0, 8, 0]`.
- `Animator.preview()` can make the camera drift.

## The model

### Bones

- `root` → `skeleton-root` → `hips` → `stomach` → `chest` → `head`, arms
- Arms: `rightarm` / `leftarm` → `rightforearm` / `leftforearm`
- Legs: `rightthigh` / `leftthigh` → `rightshin` / `leftshin` → `rightfoot` / `leftfoot`

### Sizes, in model units (16 to a metre, before `npcScale`)

| What | Where |
|---|---|
| `skeleton-root`'s pivot | y 24, head height |
| hip joints, `hips`' origin | y 12.25 |
| the pelvis's underside (`hips` cube) | y 11.5 |
| knees (`shin` origin) | y 6.625: thighs 5.625 long |
| ankles (`foot` origin) | y 1.5: shins 5.125 long |
| the floor, the bottom of the foot cubes | y ≈ 0.24 |
| `stomach` / `chest` / `head` origins | y 16 / 19.75 / 24.3 |
| shoulders (`arm` origin) | y 23, x ±3.75 |

The shin's cube reaches the sole too (y 0.25), as low as the foot's, so on a tilted shin it touches the floor first.

### Rotations and channels

The mesh's Euler order is `ZYX`, and values are applied **unnegated** (`mesh.rotation.x` = keyframe x in radians).
So a bone's z applies first, about its own hanging axis, which shows nothing on a straight-down bone. Then x, then
y, in the parent frame.

- **Upper arm, x**: swings it forward (+) or back (-). Idle rests at about +5.
- **Upper arm, y**: a minor twist (idle ±0.17). On a hanging arm it only twists. At x=90 (straight forward), +y
  swings the arm toward -X: inward for `rightarm`, outward for `leftarm`.
- **Upper arm, z**: a lateral flare, mirrored per side. `rightarm` +z flares it outward (z=90: horizontal to the
  right, the elbow at +X). `leftarm` +z swings it inward, -z outward. Idle rests at `rightarm` z ≈ +2, `leftarm` ≈ -2.
- **Forearm, x**: the elbow's bend, forward (+). Idle's 9 is a slight bend; 65+ puts the hand well in front.
- **Forearm, z**: a lateral wrist turn. `leftforearm` +z turns it inward.
- **Head**: +z tilts its top toward -X (the character's left). -x bows it forward, +x looks up.
- **Torso** (`stomach` / `chest`): -x leans forward, e.g. `sit`'s slump of -4 / -5. Arms and head are children of
  `chest`, so a lean pitches an outstretched arm at the floor unless its x is raised by as much.
- **Legs**: +x swings forward, knees bend with -x, a foot's +x lifts the toes.
- **Position** channels are world-axis, with no flip: +y up, **+z backward**, so a push forward is -z.

### Legs and the floor

- `skeleton-root` pivots at head height, so idle's root x sway (0 → 2.5) swings the feet about 1 unit along z.
  Idle's leg rock cancels it. A pose with planted feet must zero the root's rotation, else the figure drifts.
- The ankle sits about 2 units **ahead** of the hip. So swinging a leg forward *raises* the foot (14° → +0.8),
  whilst swinging it back barely lowers it.
- The boot is too short to tip-toe, so a split stance cannot ground both feet. Use modest angles, and take up
  what is left with `skeleton-root`'s position y.

### Breathing: the head is on the end of the torso's lever

Head and arms are children of `chest`, so breathing by torso *rotation* (stomach / chest x → 0) shows mostly as
the head pitching: `sit` inherits a 9° sway before its own nod. Two ways round it:

- **Counter the head.** `sit`'s head is x=5 at 0 / 2.5 and 0 at 1.25, with no mid-cycle nod, so its world
  pitch swings 4°, not 14°.
- **Translate, mostly.** `lie` (catmullrom) lifts the belly first and most: stomach position z -0.3 at 1.9.
  Under the 90° root, local -z is world up, and local +x on the chest LOWERS its top. Then the ribcage: chest
  position z -0.15 and rotation x -2 at 2.2, arms z +0.25 and flared ±1.5. The head counters most of it
  (position z +0.55, rotation +1.5), but not all, as a fully pinned head reads dead: it keeps a 0.1 lift and
  half a degree of nod. Peak world rise: belly 0.29, sternum 0.53, head 0.1.

## Exporting

Export from the rest pose. After any `Animator.preview()`, first run
`Animator.showDefaultPose(true); Canvas.updateAllBones()`, else the glTF's nodes keep the pose.

From code, with the exporter's last-used options (ASCII, embedded textures, armature, animations):

```js
Animator.showDefaultPose(true); Canvas.updateAllBones();
const content = await Codecs.gltf.compile(Codecs.gltf.getExportOptions());
Blockbench.writeFile(Project.save_path.replace(/\.bbmodel$/, '.gltf'), { content, savetype: 'text' });
```

Save the project first (`BarItems.save_project.trigger()`). Check the result: every node's rest transform as before,
and every other clip with the same number of channels. The running dev page picks the new glTF up by itself. If not,
see "Recovering" in `docs/mcp.md`.

### Clips keyed from code

`scripts/src/bins/gen-clip-keys.ts` re-keys clips whose motion is solved rather than posed. It writes the keyframes
into `current.bbmodel` AND bakes them into `current.gltf` as the exporter would (a key a frame, `LINEAR`), so
Blockbench need not be open.

Each entry of its `clips` is a RECIPE: default `params`, and `tracks(params)` returning one `Track` per bone channel.

- `turn`: a posed rotation.
- `breathe(a, b)`: a value that swells with the cycle.
- `plantedLegs`: a root and legs solved so both feet stay put. It throws if a leg cannot reach.
- `steppingLegs`: a root and legs solved so each ankle follows a path (`stepping`), the sole kept flat. It solves
  thigh x, thigh y (the knee turned out) and the knee. Thigh z twists the thigh about its own length, so it is not used.
- `mirrored`: a clip's tracks for its mirror.

A clip's length is read from the bbmodel: a gait is 1s, keyed every frame.

```sh
node scripts/src/bins/gen-clip-keys.ts                        # every recipe
node scripts/src/bins/gen-clip-keys.ts phaser_aim rock=0.6 drop=0.4
```

| Recipe | Params |
|---|---|
| `sit` | `knee` |
| `sit_reach` | `leg hold`, frames |
| `crouch` | `down back lean reach` |
| `crouch_cover`, `crouch_half` (`crouchStill`) | `down back lean splay toeOut breathe rise bob armX armZ foreX foreZ` |
| `crouch_walk`, `crouch_half_walk` (`crouchWalk`) | `down back lean splay toeOut stride duty lift sway bob swing heel toe armOut foreX abduct` |
| `crouch_strafe_right`, `crouch_half_strafe_right` (`crouchStrafeRight`) | `down back lean splay toeOut stride duty lift bob abduct` |
| `crouch_backwards`, `crouch_strafe_left`, and the half crouch's | none: the walk reversed (`reversedOf`), the strafe mirrored (`mirroredOf`) |
| `phaser_aim` | `rock drop sink lean breathe`; also keys `phaser_aim_avoid` |

- A clip new to the glTF is added to it, but must already be an animation of the bbmodel: make it in
  Blockbench, and save.
- It appends to the glTF's buffer, so restore both files first: `git checkout`, or re-export from Blockbench.
- Reload the project in Blockbench afterwards, else a save puts the old keys back.

## Clips

| Clip | Length | What | Made |
|---|---|---|---|
| `walk` / `run` | 1 / 0.75s | gaits, feet planted | solved |
| `sit`, `lie` (`_left`, `_right`) | 2.5 / 4s | at rest, breathing | `sit`'s legs solved |
| `phaser_aim` / `_avoid` | 2.5s | the phaser stance, rocking | solved |
| `point` / `_avoid` | 2.5s | jsh `pose`, upper body | posed |
| `influence` | 2.5s | hand on the temple, pushing | posed |
| `psi` | 2.5s | left hand at the temple | posed |
| `drop`, `pick_up`, `crouch` (`_left`) | 2.5s | putting down, taking up | posed; `crouch` solved |
| `crouch_cover` | 2.5s | a still squat behind cover | `crouch`'s legs, arms searched |
| `crouch_walk`, `crouch_strafe_right` (`_left`), `crouch_backwards` | 1s | crouched gaits | solved |
| `crouch_half`, and its `_walk`, `_strafe_right` (`_left`), `_backwards` | 2.5s / 1s | the half crouch | solved |
| `sit_reach` | 2.5s | reaching from a seat, past a table's edge | solved |
| `pain_*`, `{sit,lie}_pain_*` | 1.2–1.6s | a hit | posed by search |
| `pacified`, `{sit,lie}_pacified` | 3s | after a head shot | posed |
| `collapsed` | 1.8s | after a body shot stood: on the floor, breathing hard | posed by search |
| `dodge_*`, `{sit,lie}_dodge` | 0.8s | a shot dodged, once | posed |

### walk / run: planted feet

Legs and root were solved, not hand-keyed.

- **Speed.** The npc moves `1 / gait` metres a cycle (`gait` in `npc-animation.ts`: walk 1, run 0.5). At 1/16 ×
  `npcScale` (0.7), a stance foot must slide back **22.86 u/s** walking and **45.72 u/s** running. Walk's stance
  speed checks within 0.5%.
- **Solving.** Legs, knees, feet (x only) and `skeleton-root`'s position y were solved by 2D IK from a foot path:
  heel strike, flat, toe-off rocker, Hermite swing. The root came from a target stance-knee bend, low-passed under
  the reach limit. 24 keys a cycle: 12 was too coarse, as the rockers sank the foot by up to 0.17. Leg and knee
  position channels were dropped, and run's root rotation -2 moved onto `hips` x.
- **Hand-tweaking one leg key breaks the plant.** Re-measure a foot's lowest vertex at each sample.
- **Walk**: the left heel strikes at t=0, duty 0.5. Heel strike 22° toes-up, toe-off -34°. Bob -0.84 … +0.15.
  Stance knee -16 … -35°: these short legs need the big heel and toe rockers for the long stride. It leans from
  the hips: `hips` x -11 at contact / -9 passing, `chest` -2 / 0. The head +4 / +2, so it tips down with the body.
  Arms raised +10.5 / +7 over their original swing, so they still hang.
- **Run**: the left foot lands at t=0, duty 0.27. Bob -0.87 … -0.29. The swing knee reaches -115°.
- **Arms**, hand-keyed, not flat: the forearm stays bent and turns IN as it comes forward (`rightforearm` z -,
  `leftforearm` +), so the hand nears the body's middle whilst the elbow barely moves out. Arm x and y are as they were.

  | Per swing: forward / coming back / back / going forward | walk | run |
  |---|---|---|
  | arm z | 8 / 8 / 9 / 8 | 12 / 9 / 16.2 / 8 |
  | forearm x | 16 / 9 / 5 / 10 | 32 / 12 / 10 / 20 |
  | forearm z, in | 16 / 10 / 6 / 10 | 6 / 10 / 6 / 12 |

  Walk's forward hand is 1.1 nearer the middle, and its elbow 0.3 further out.
- **Walk's torso turns with the arms**, above the hips. `hips` are left be, as the legs hang off them and a turn
  there slides the feet. At each heel strike, `stomach` [-1.5, ±3, 0] and `chest` y ±4, the forward arm's shoulder
  leading by 1.4. Passing, `stomach` z ±1.5 and `chest` z ±1, leant over the stance leg. The head undoes both
  (y ∓9, z ∓2.5), so it faces ahead to within 2°.
- **Run's likewise.** Landing, `stomach` [-9.5, ±3, 0] and `chest` y ±3, on the hips' ±6.94. Passing, `stomach`
  z ±2 and `chest` z ±1.5. Head y ∓12.94, z ∓3.14 landing and ∓3.5 passing. The turn carries the forward hand
  across the middle, so that arm's y is -4 (was 4.6) and its forearm z 6 in: the hand is 2 off the middle.

### sit

- **Legs**: thighs level (x 90), knees bent 80° (shin x -80), feet x -12 at 0 / 2.5 and -7 at 1.25, so the soles
  sit near flat and breathe. That is the `sit` recipe. The shin and foot hang 0.28m, so on any higher seat the feet
  dangle: one clip serves every seat height.
- **Root**: `skeleton-root` position y -11.
- **Arms** rest in the lap, still through the breath, with every arm position key [0,0,0] so they do not float.
  Read from `current.bbmodel` on 2026-10-16, at t=0:

  | Bone | x | y | z |
  |------|---|---|---|
  | rightarm | 5.7842 | 7.0689 | 5.1276 |
  | rightforearm | 50 | 0 | 0 |
  | leftarm | 4.8748 | -10.9991 | -6.0008 |
  | leftforearm | 44.0142 | 1.4116 | -3.0691 |

- **Breathing**, out at t=0 / 2.5 and in at 1.25. The head counters it (see *Breathing* above):

  | Bone | channel | t=0 / t=2.5 | t=1.25 |
  |------|---------|-------------|--------|
  | chest | rotation x | -5 | 0 |
  | chest | position y | -0.15 | +0.05 |
  | stomach | rotation x | -4 | 0 |
  | stomach | position y | -0.12 | 0 |

### phaser_aim / phaser_aim_avoid (catmullrom at 0 / 1.25 / 2.5)

`Phasers`' phaser: a stance stood in at rest, and played over the upper body on the move.

- Root rotation zeroed, and the feet pinned flat (0.27 / 0.21), left foot forward.
- The right forearm is level and dead ahead at t=0 (`along` `(0, 0, -1)`, its +x up). The arm's x rises with the
  lean as it breathes. The left arm is idle's, free for psi.
- `phaser_aim_avoid` shares the legs, torso and head. Its right forearm is raised beside the shoulder, muzzle up,
  solved from a target basis via `Euler.setFromQuaternion(q, 'ZYX')`.

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

**The stance is balanced, and rocks.** As first keyed, it stood over its front foot with the other trailing, and
leant 9°–14°. Now the feet keep that spacing but are planted either side of the hips (ankles z -1.17 and 3.17
about the root's 1), with the hips 0.5 lower to reach them. The torso leans 2° at the back of the rock and 5° at
the front. The head counters it, and each arm's x is raised by as much, so the gun stays level. The root rocks 0.9
end to end about where it stood, sinking 0.25 as it goes forward.

The legs are SOLVED so both ankles stay put and both soles flat, keyed every fifth frame. `phaser_aim_avoid` has
the same root, legs, torso and head. Re-key with `gen-clip-keys` (see *Clips keyed from code*).

### point / point_avoid

jsh `pose`'s pair, upper body only. Idle's legs, sway and left arm, so it reads as pointing, not a guard.

- `point` leans a little (stomach -3, chest -2, head 5), the right arm level and dead ahead (`rightarm` x 95,
  `rightforearm` [0,90,0]).
- `point_avoid` stands as idle does, the right forearm raised before the shoulder (`rightarm` [12,0,5],
  `rightforearm` [88.07,-57.53,86.74]: `along` `(0, 0.93, -0.37)`).

### influence (catmullrom at 0 / 1.25 / 2.5)

Idle's root sway and breathing, leaning forward, the right hand on the right temple, the left arm outstretched,
the left foot forward. t=1.25 is the push: a deeper lean, the arm rising and shoving forward, the hand staying on
the temple.

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

Stomach and chest position, and the legs' z, are idle's. The root's rotation is zeroed and the legs pinned, so
the feet stay put (see *Legs and the floor*).

### psi

`Psi`'s hand. The LEFT arm alone, so the right is free for a phaser: it plays over that arm only, so no legs or
root. The hand at the temple, the elbow tucked in front (`leftarm` [112,0,20], `leftforearm` [128,0,-20]), with a
small lean (stomach -8, chest -5, head -2). It was `psi_avoid`: the first `psi` had the elbow out to the side
(`leftarm` [110,35,0], `leftforearm` [130,0,-8]).

### Putting down and taking up

- **`drop`** (`w.e.dropItem`, onto a table): upper body only, a still pose that the game eases in and out. A lean
  (stomach -6, chest -4, head 4), the right arm reaching forward and down to table height (`rightarm` x 56,
  `rightforearm` x 8). The left arm is idle's (`leftarm` [5,0,-2], `leftforearm` x 9).
- **`pick_up`** (`w.e.takeItem`): likewise still and upper body. A deeper lean (stomach -9, chest -7, head 3), the
  right arm lower with the elbow bent to grasp (`rightarm` x 50, `rightforearm` x 28).
- **`crouch`** (`w.e.reachFor`, on or off the FLOOR): a still whole-body squat. The feet where they rest, the root
  8.5 down and 3 back, the legs solved to them. The torso leans 60 (stomach and chest -30 each, head 40). The right
  arm hangs 22 forward of plumb, so the hand touches the floor ahead; the left rests on the knee. Recipe `crouch`.
- **`crouch_cover`** (jsh `pose rob as:crouch_cover`): a still squat behind cover, e.g. a sofa, kept as the rest
  clip. `crouch`'s legs (root 8.5 down and 3 back), a lean of 40 (stomach and chest -20 each), the head level (40).
  The elbows rest on the knees, searched: see *Splayed* below. The head's top is
  at y 21.1, 1.05m. Armed, `phaser_aim`'s arms play over it, raised 33 for the lean: the forearm is level at y 13.4.
  Recipe `crouch_cover`.
- **`crouch_walk`** / **`crouch_strafe_right`**: `crouch_cover`'s hips and lean, stepping flat-footed. Each foot is
  planted for 0.6 of the cycle, sliding back, then lifted 1.5 (1.2 sideways) and swung ahead. Ahead, 8 a cycle
  (0.4m), the left foot landing at 0, the hips swaying 0.4 over the planted foot, the arms hanging forward and
  swinging 8. Sideways, 5 a cycle (0.25m), the right foot leading, the feet set 0.75 wider so they never meet. The
  hips bob 0.3 twice a cycle. `crouch_backwards` is `crouch_walk` reversed, `crouch_strafe_left` the right one mirrored.
- **Splayed**: every crouch clip sets its feet `splay` out either side (1.5 full, 1 half) and turns its toes out
  `toeOut` (20, 15). The legs are solved in 3D (`splayedLegs`, `steppingLegs`), so the thighs turn the knees out to the
  wider feet. Its gaits share the stance, so moving off does not shift the feet. Mid-swing the knees turn further out
  (to 33 full, 43 half), the step of a duck walk.
- **Breathing**: both still crouches breathe over their 2.5s. Breathing in, the torso straightens `breathe` (3), the
  chest rises `rise` (0.15) and the hips `bob` (0.15), the legs re-solved so the feet stay put. The head stays level,
  and each arm keeps its pitch in the world, so the elbows and hands stay where they rest.
- **`crouch_cover`** leans 40: arms [40,0,±10], forearms [70,0,∓40], elbows on the knees.
- **`crouch_half`**: the same still recipe, less low. Hips 4 down and 1.5 back, a lean of 32, the head's top about
  1.30m. Its arms were searched so the hands rest on the knees: arms [-5,0,±12], forearms [70,0,∓50].
- **Its gaits are a sneak**, not a splayed squat carried along: hips 2.5 down, a lean of 18, the legs near parallel
  (`splay` 0.3, `toeOut` 5), arms at their sides as `walk`'s (`armOut` 5, forearms 15, swinging 10). Each foot strikes on the heel (`heel` 10,
  toes up), rolls flat, and comes off the toe (`toe` 15): `heelToe` pitches it, and `rockerLift` raises the ankle so
  the heel or toe stays down (`footSole`, measured off `phaser_aim`'s feet). Strides 8 ahead (0.4m) and 5 sideways
  (0.25m). Each leg moves sideways by swinging out at the hip (`abduct`, thigh `z`): turning the thigh instead flared
  the knee 43° as the foot left the ground, the foot nearly under the hip.
- `steppingLegs` sets each frame out from the last frame's solution, and moves at most `maxStep` a Newton step. From a
  fixed guess the half crouch's legs jumped to another branch, a thigh turned 2358°.
- **`drop_left` / `pick_up_left` / `crouch_left`**: mirrors for the other hand. Left and right bones swapped,
  rotation y and z and position x negated. Re-mirror after changing the originals.

### sit_reach

`drop` and `pick_up` for the SAT (`w.e.reachFor`). `sit` rests the hand on the lap, under a table, and easing
straight to a reach pose brought it up through the top. So this one MOVES: a pose every 4 frames, the reach held 3,
then back. That is 35 frames, the rest of the 2.5s held on `sit`'s arm. Recipe `sit_reach`.

Its `stomach` and `chest` keys are turns ON `sit`'s own torso, not poses of it (the game's `upperAddsTorso`). So
alone in Blockbench it shows them off an upright torso; the arm is keyed against that.

| pose | stomach | chest | rightarm | rightforearm | hand |
|------|---------|-------|----------|--------------|------|
| sit | 0 | 0 | [5.7842, 7.0689, 5.1276] | [50,0,0] | on the lap |
| back | [1.5,0,0] | [1.5,-5,0] | [-30,0,10] | [75,0,0] | beside the hip, clear of the edge |
| up | [3,0,0] | [3,-8,0] | [-55,0,20] | [130,0,0] | by the ribs, above the top |
| over | 0 | [-1,2,0] | [5,0,0] | [115,0,0] | before the chest, over the edge |
| out | [-4,0,0] | [-4,6,0] | [84,0,0] | [15,0,0] | reaching: the game aims it from here |

- `chest` +y brings the right shoulder forward. A deeper lean at `out` dips the hand into the top.
- Solved against a table 0.6m high whose edge is 0.15m ahead of the hips (the end seat of `table--004`), the
  forearm's tip staying a unit clear of it.
- If `sit`'s arm changes, its first pose must follow.

### Hits, stood: pain_* / pacified

Drafts, posed by search: legs solved so the feet stay planted, hands solved onto a bone by the forearm's tip
`(0, -5.6, 0)`. What each leads to is `hitConfig` in `const.npc`: see `docs/engagements.md`.

- **`pain_high`** (1.6s loop, whole body): doubled over ~50 from hips, stomach and chest, the forearms crossed on
  the stomach. The fold deepens at 0.8, and `hips` z and `head` shake, a key every 0.1s, linear.
- **`pain_leg_left` / `_right`** (1.2s loop, whole body): the other foot planted, this one lifted onto its toe, the
  torso tipped over it, the same-side hand on the thigh. `_right` is the mirror.
- **`pain_arm_left` / `_right`** (1.2s loop; torso, head and BOTH arms, no legs or root): the arm folded across the
  body, the other hand on its forearm. `_right` is the mirror.
- **`pain_head`** (1.5s, once, was `pacify_in`): a jolt back at 0.25, the knees buckling at 0.6, a half recovery at
  1.0, ending on `pacified`'s first key.
- **`pacified`** (3s loop): slack, the head lolled, the arms dead, a slow sway of `hips` z.

### collapsed (catmullrom at 0 / 0.9 / 1.8)

After a body shot stood (`pain_high`): sat on the floor, knees drawn up, the left forearm over the knees and the right across them, slumped, breathing
hard but slowly: at 1.2s a breath it distracted. The root drops to seat the pelvis's underside on the floor (`skeleton-root` position [0,-10.81,1], rotation
0). The legs were searched so the lowest of shin and foot sits on the floor with the foot level. The right forearm
lies across the knees so a gun in hand stays inside their footprint, and the spine is kept fairly straight with a
small nod, as a deeper slump put the head into a neighbour's.

| Bone | channel | t=0 / t=1.8 (out) | t=0.9 (in) |
|------|---------|-------------------|------------|
| hips | rotation | [6,0,0] | same |
| stomach | rotation / position y | [-6,0,2] / -0.15 | [-3,0,2] / 0.1 |
| chest | rotation / position y | [-4,0,0] / -0.15 | [0,0,0] / 0.25 |
| head | rotation | [-18,6,10] | [-16,6,10] |
| rightarm | rotation | [45,-1,11] | [39,-1,12] |
| leftarm | rotation | [38,0,-6] | [32,0,-7] |
| rightarm / leftarm | position y | 0 | 0.45 |
| rightforearm | rotation | [36,80,-48], across the knees | same |
| leftforearm | rotation | [35,0,10] | same |
| thighs | rotation | [140,0,±8], knees drawn in | same |
| shins / feet | rotation x | -93 / -48 | same |

### Dodges (catmullrom; once, 0.8s)

Each is checked by raycasting the beam's line through its part's centre in the rest pose (`window.__dodge` in a
session: `centre`, `hits`). Each starts and ends on its base's first key: `breathe` stood, else `sit` or `lie`. Stood, a crouch of `a`
keeps the feet planted: thighs `a`, shins `-2a`, feet `a`, root rotation 0 and position y `-10.75(1 - cos a)`.

- **`dodge_duck`** (head): a crouch of 55 at 0.2, 50 at 0.45. Stomach -25, chest -15, head -15, arms up over the head
  (arms [130,0,±15], forearms 110).
- **`dodge_duck_low`** (torso): a crouch of 60 with a bow (stomach -45, chest -31.5, head -12), the arms tucked
  ([71,0,±6], forearms 70). Searched as the least crouch and bow whose body is off the beam's line through the rest
  pose's chest centre `(0, 20.36, -0.11)` from 8 bearings, ±0.5 across and up: clear from 0.18 to 0.45. It reaches
  no wider than at rest, but bows 8.4 forward, towards the shooter.
- **`dodge_arm_left`** (left arm): the root slid 0.8 to +x in a crouch of 15, a lean of -4 (stomach z), the left arm up
  at [120,0,-10] with the forearm at 40. Searched as the least that keeps the body off the left forearm's line
  `(-4.04, 13.76, -1.11)` from ahead (±10 degrees, ±0.5): wider, the hips are in the way, so the game turns them to
  face the shot. Thigh z searched so the feet stay planted. **`dodge_arm_right`** is its mirror: left and right bones
  swapped, rotation y and z and position x negated.
- **`dodge_hop`** (legs): a crouch of 30 at 0.12, in the air at 0.32 (root y +2, thighs 65, shins -110, feet 30, arms
  out ±45), landing in a crouch of 30 at 0.52. The feet clear the floor by 6.5.
- **`sit_dodge_duck`**: a fold from `sit` (stomach -42, chest -29.4, head -20), hands up by the head.
- **`sit_dodge_brace`**: folded onto the knees (stomach -75, chest -52.5, head -20), arms over the head.
- **`sit_dodge_lean_left`** / `_right` (mirror): a sideways lean (stomach z +30, chest z +14, head z -16), the far arm up.
- **`sit_dodge_back`**: a recline (stomach x +28, chest x +16, head +8), hands up before the face.
- **`sit_dodge_legs`**: both legs lifted nearly straight (thighs 105, shins -10, feet 10).

There are no lain dodges: the game makes a dodged shot at someone in bed a hit. Sit-ups, rolls, curls and
propping up on an elbow were tried, from the back and from either side, but a steep beam onto a bed rarely clears.

**Which part each clears, from where,** is `hitConfig.dodgeClips` in `const.npc`: 24 characters a part, 15 degrees
apart from ahead round to their left. Measured with `window.__dodge.mask2(clip, centre, times, tilts, margin)` in a
session: rays along the beam's line through the part's centre in the base pose, at the tilts a standing shooter's beam
meets that part (stood head 0 to 8, chest -4 to 4, forearm -8 to 0, shin -15 to -5; sat head -4 to 4, chest and upper
arm -6 to 2, shin -15 to -5), ±0.25 across (the beam is 0.2 thick), at 0.25, 0.3 and 0.35 around its arrival.
Re-measure after changing a dodge.

Tried and dropped, sat: a sat hand's line meets the thigh from all but dead ahead or behind; a twist-and-bend, a fold to
the toes and a fall onto the side moved too much near other sitters.

### Hits, sat and lain: `{sit,lie}_pain_{low,high}`, `{sit,lie}_pacified`

Drafts too. Each keeps its base's root and seat or bed: `sit`'s root and legs (feet -10, still), `lie`'s root.
Lengths are the standing set's.

- **`sit_pain_high`** (1.6s): folded ~26, ~33 at 0.8 (stomach -14 / -18, chest -12 / -15), with `pain_high`'s
  crossed forearms. The shake is `stomach` z and `head`, a key every 0.1s, linear: `hips` would swing the legs.
- **`sit_pain_low`** (1.2s): stomach -9 / -11, chest -8 / -9, head bowed -6 / -10 with a small y shake, shoulders up
  (arm position y 0.3 / 0.45), hands forward onto the knees (arms x 18).
- **`sit_pacified`** (3s): `sit`'s arms, in the lap. Slumped (stomach -8, chest -7), the head lolled as `pacified`'s
  ([-14,5,12]), `stomach` z swaying 2.5 / -2.5.
- **`sit_pain_head` / `lie_pain_head`** (1.5s, once, were `{sit,lie}_pacify_in`): from the base's first key to the
  pacified one's, keyed at `pain_head`'s times.
  - Sat: thrown back at 0.25 (stomach 5, chest 6, head 18, arms flung out, shins kicked to -70), slumped past it at
    0.6 (stomach -14, head -22).
  - Lain: a start at 0.25 (stomach -7, chest -5, arms and knees lifted), then the head rolls over, past its rest at
    0.6 (y 30).
- **`lie_pain_high`** (1.6s): a curl, not an arch. Stomach -10 / -14, chest -8 / -11, knees up (thighs 35 / 40,
  shins -60 / -66, feet 10), with the crossed forearms and the same shake.
- **`lie_pain_low`** (1.2s): stomach -3 / -5, the head turned aside (y 20) with a small shake, fists drawn up over
  the chest (arms [8,0,±8], forearms [128,0,±22]), the right knee a little raised (thigh 14, shin -24).
- **`lie_pacified`** (3s): the head rolled aside ([0,24,5], position z -0.5 so it stays on the pillow), arms and legs
  splayed a little, a shallow breath (stomach position z -0.15 at 1.5).

Measured mid-clip: no sat hand rises above the lap but `sit_pain_high`'s, at y 4.4–5.6 against the stomach. The
table top was ASSUMED at y ~6, as no clip records it. Lain, the lowest point is the head, 0.4 under `lie`'s.

## Legacy

`thinner.more-anims.wip.bbmodel`, the arm notes' first source, had `idle`, `walk`, `run`, `sit`, `shuffle-back`
and `lie`. Its arm conventions were confirmed on `current.bbmodel`.
