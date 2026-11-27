# Blockbench

Npc models are made in Blockbench, which Claude Code can drive through an MCP plugin:

- https://github.com/jasonjgardner/blockbench-mcp-plugin
- plugin script: https://jasonjgardner.github.io/blockbench-mcp-plugin/mcp.js
- in VSCode Claude Code, `/mcp` — possibly reconnect

## Tips

- Can select a model face.
- Can drag a UV square area (not diagonally).
- Select two objects, then Cmd+Drag to create a box, e.g. of vertices.
- `z` toggles wireframe.
- RMB translates the view.
- Import GLTF seems to cache the file unless you close it and choose it again.
- Personal keybinding: Shift+P for the perspective camera.

## Exporting

![exporting a smooth curve](blockbench/sample-rate.svg)

The model is `packages/media/src/blockbench/current/current.bbmodel`. Export it as glTF to `current.gltf` beside it: ascii, embedded textures, armature, animations.
- **Export at rest.** Show the default pose first (`Animator.showDefaultPose()`, Edit mode alone is not enough). The glTF takes the pose on show as its bind pose, and a posed one breaks every reshaped body (`docs/skins.md`), e.g. a forearm lying across the chest.
- **Animation Sample Rate is 48** (Settings, Export). A smooth (catmullrom) curve is sampled at that rate, but the exporter drops any sample within one interval of a keyframe. Many clips have keyframes every 1/12s, so at the default 24 nearly every sample is dropped, and the curve becomes straight lines. At 48 every 1/24s sample is kept, and each clip plays as Blockbench previews it.
- A DEV World loads `current.gltf`, and refetches it on each export (`docs/mcp.md`).
- The dev server, and the pre-commit hook, write `current.glb` from it (`gen-current-glb`), which production loads. It is deduped, pruned and resampled: a keyframe its neighbours' line matches to within about 2° goes (`resampleTolerance`, 5e-4). That keeps it smaller than a 24 export's, about 77KB brotlied.
- Compare sizes with `pnpm compare-brotli packages/media/src/blockbench/current/current.glb`.

## A new clip

1. Make it in Blockbench and export, as above. Name it as the World will, e.g. `talk_left`, without Blockbench's `animation.` prefix.
2. Add it to `fromAnimationClipKey` in `const.npc.ts`, and to the fade table below it (`{}` for the default fade).
3. An upper clip over one arm, e.g. `point` or `talk_left`, is posed by jsh `pose rob as:talk_left` once it is in `poseConfig.poses`, with its arm (`side`) and the clip it draws in to near others (`avoid`, else `null`). Only a right arm's pose aims at whom it is `at`.
4. A clip that mirrors another, e.g. a left-handed take, is not made in Blockbench. It goes in `fromAnimationClipKey` and the fade table as usual, and in `mirroredClips` by the clip it mirrors (see Mirrored clips).

`talk_left` is the left arm talking: a 2.4s loop of the forearm raised and beating, with an open gesture midway. It moves `leftarm` and `leftforearm` alone, so it plays beside a right arm's pose.

## A skin's own clips

A skin's meta can name a prefix, `clips=scp_096`. Its wearer then plays each clip `{prefix}_{key}` in place of `key`, e.g. `scp_096_walk` for `walk` (`npc.syncSkinClips`, `npc.skinClips`). Their pose is still `walk`, so gaits, posture and fades go by it.

- Make one as a new clip, above, named `{prefix}_{key}`: the same length as `key`'s, so a walk keeps its pace (`gaitStride`).
- Key every bone, even if only at rest, and `skeleton-root`'s position too. A bone a clip leaves unkeyed stays wherever the last clip left it, so they float or lean.
- Keep it upright and within the run's reach (`x` within ±6.58 px, `z` from -11.1 to 1.4 px): nothing prone.
- An idle that reaches further, e.g. hands held at a hunched face, can take a drawn-in take, `{prefix}_breathe_avoid`. Whilst another stands within `poseConfig.idleNear` (1 m), and `holdSecs` after, it plays instead (`syncIdleAvoid` in `NPCs`), as a pose's `avoid` does.
- `scp_173_breathe`: a statue. Stood rigid, a head snaps aside for a frame now and then. It has no walk: it is placed, never seen to move.
- `scp_049_*`: upright, the hands clasped behind, the head tilting as it studies. Its walk is a deliberate stride, arms still.
- `scp_035_*`: too still, the head tilting with too much interest then snapping back, a forearm twitching. Its walk is too smooth: no bob, no sway.
- `scp_017_*`: hunched and utterly still, then a slow head turn. Its walk floats: raised about 0.1m and bobbing once a cycle, it leans in with its arms hanging back and its legs trailing, toes down.
- `scp_1000_*`: a slow sway, heavy breaths, the head scanning, long arms swinging. Its walk rolls heavily. Its body is big for an agent, so its skin's meta has `agentRadius=1.5`: the crowd keeps others off it.
- `scp-650` wears `clips=scp_173`: a statue too.
- `scp_096_*`: hunched, the hands over the face, shoulders heaving in sobs. Its walk shambles in short steps, swaying.
- `scp_049_2a_*`: a gaunt zombie, slack, the head lolled and twitching, the arms half raised. Its walk shambles, lurching side to side.
- `scp_049_2b_*`: a fresh zombie, slumped on its left leg, the head hanging, the arms limp. Its walk limps, the right leg stiff and dragging. Both have `agentRadius=1.6`. They have no run: hurried, the default `run` plays.
- `scp_682_*`: a restless predator in a deep crouch, its head level. Over a 6s idle the head weaves like a snake, then holds, then snaps at 3s. A shudder runs up the body at 4.5s, its regeneration. The chest swells slowly and empties fast, and the claws twitch. The snap and shudder are linear keys, so they stay sharp. Its walk is a stalk on the walk's own legs, crouched and splayed, the shoulders rolling against each step while the head stays locked forward. Its skin's meta has `agentRadius=1.75`, the most the crowd allows: keep every part within about 0.42 m of its centre, or it reaches into others.
- `scp_106_*`: stooped and slack, the head lolling, the arms limp. Its walk limps, the right leg dragging stiff.

## The duck

`duck` is a stoop: the back bent forward, the knees a little bent, the head tilted up to look ahead. It is a 0.25s clip from rest to the stoop.

- It is made additive at load, against its first frame (`makeClipAdditive` in `NPCs`), so it adds only the bend over any gait. Their stride and pace stay their own.
- `anim.setDuck` eases it in or out over `duckConfig.fadeSecs`, held at its last frame (`tickDuck`). Only whilst stood upright, not crouched. `setPose` leaves it be.
- Tall npcs stoop under lintels with it (`docs/skins.md`). It lowers a 1.2-height npc's head about 0.2m. Keep its first key the rest pose, every bone keyed.

## Mirrored clips

Some clips are made at load by mirroring another, so they are in neither the `.bbmodel` nor the glTF. `mirroredClips` in `const.npc.ts` lists each by the clip it mirrors, and `NPCs` builds them with `mirrorClip` (`service/clips.ts`).

- **How.** Left and right bones' tracks swap, rotations' `y` and `z` are negated, and positions' `x`. That is exact only because the rig rests unrotated and symmetric: keep it so.
- **Which.** The left or right take of a symmetric clip: `crouch_left`, `drop_left`, `pick_up_left`, `lie_right`, `pain_arm_right`, `pain_leg_right`, and the left crouch strafes. Each matched its old Blockbench take to 0°. Also each death's mirror, `die_back_mirror` and `die_forward_mirror`, which a death plays at random, and each get-up's, `get_up_back_mirror` and `get_up_forward_mirror`.
- **Editing one.** Edit the clip it mirrors: its mirror follows on the next export. Never make the mirror in Blockbench too, as the made one replaces it.
- **Not for** clips whose sides differ on purpose, e.g. `strafe_*`, `shuffle_step_*` and `run_strafe_*`, whose lead foot or timing differs. Nor for one holding something in a hand: the item stays in the right hand whilst the arms swap.
- `gen-clip-keys` writes only the right crouch strafes. Their left ones are mirrored at load.

## The run

`run` is a `0.752` s loop covering `gaitStride.run` (2.23 m) a cycle. Its legs were solved, not keyed by hand, so a planted foot never slides. One model pixel is about `0.053` m in game.

- **Timing.** Each foot is planted `5/24` of a cycle, the right from `12/24` to `17/24`, with `7/24` of flight between. The stride is long through flight, not stance: the legs (10.95 px) cannot sweep further than `8.65` px under the hip.
- **Legs.** The ankle's path and the foot's angle are the older run's, re-timed. Each key's thigh and shin are solved by two-bone IK against the rig's pivots.
  - Planted, the knee is set (12°, 56°, 58°, 48°, 36°, 20°) and the root's height follows from it. So the body is lowest just after landing.
  - In the air, the root follows a ballistic arc `0.78` px high. The ankle keeps its height relative to the hip.
  - The left leg is the right half a cycle on.
- **Landing.** The toes rise 12° a key before contact. The heel strikes with them 8° up, and the foot slaps flat by a half-step key 16 ms later (at `0.5/24` and `12.5/24`). The root keeps falling through contact. A key later the head, chest and stomach nod 4°, 2° and 1°.
- **Arms and torso.** The elbows stay bent 70° to 95°, the shoulders swinging `+35°` to `-28°`. The chest and stomach turn against the hips, so the head barely turns.
- **Reach.** The arms' box is no larger than the older run's: `x` within ±6.58 px, `z` from -11.1 to 1.4 px. Check it after any edit, as the arms swing on near walls (`CLAUDE.md`, World).
- **Pace.** Edit the legs and `gaitStride.run` must be re-measured: the planted foot's speed times the clip's length.
- A foot dips about 0.1 px into the floor for a few ms after landing, where the curves of the root and legs differ.

**Adding a key between keys.** A key made in the UI or by `createKeyframe` snaps to the clip's `snapping` (31.92 fps for `run`, its key spacing), so it replaces a neighbour. Add one off the grid with `animator.addKeyframe(data)` instead.
