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

### Sit animation — arm position keyframes

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
