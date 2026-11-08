# Camera

The World's camera: `service/camera-controls.ts`, driven by `WorldView`.

**Setup**
- A custom `MapControls` subclass in `service/camera-controls.ts`.
- Props flow: `WorldView.tsx` `ctrlOpts` → `<CameraControls>` (JSX wrapper) → `<primitive>` on the controls instance.
- `CameraControls.jsx` exposes a JSDoc `@typedef Props`. `WorldView.tsx` types `ctrlOpts` as `MapControlsProps`.
- r3f skips `undefined` props, so a prop `ctrlOpts` omits keeps the class default. That is how `zoomToCursor` stays on.

**Pointer** (`onMouseDown`)
- A left drag pans, a right drag turns. Shift, ctrl or alt held swaps them. The middle button zooms.
- Whilst following, panning is off (`enablePan`), so a left drag turns.
- On touch, one finger pans and two turn or pinch.
- Whilst following on touch, a one-finger drag moves where the player looks instead (`touchLook`), and a tap still picks. Two fingers turn or pinch as ever.

**Framing** (`w.view.cameraView`, `setCameraView`, `service/camera-view.ts`)
- Set by its fov and the metres of floor seen top to bottom at each zoom stop, not by the stops' distances: `distanceOfView(view, fov)`.
- So a new fov keeps the floor seen at each stop, as a dolly zoom: only the perspective changes.
- The menu's **framing** row, beneath **camera**, has the presets, a reset, and a pop-up with a vertical slider for each. Only its button opens or closes it, so it stays open beside the menu, and goes with it.
- Its presets (`cameraPresets`) are whole framings: a wider fov nearer in, its near view a smaller share of the default's, and its far view too (`mid` 0.85, `high` 0.7), to stay zoomed in. `mid` is not `reset`, the device's own defaults.
- Saved site-wide (`getSiteStore`, key `site`), as the light slider is. `ctrlOpts`, reset on hmr, reads it back.

**Keys**
- `1`, `2` and `3` select the fade mode: `sight`, `sense`, `ship` (`fadeRoomsModeByKey`). The menu's button cycles them.
- `0` toggles the spots overlay (`w.spots.toggle`), as the debug menu's **spots** does.
- `-` and `+` (or `=`) step the camera's framing down or up through the presets, low, mid and high (`stepCameraPreset`), from whichever is nearest by fov.

## Zoom

**Zoom has two stops**, `minDistance` and `maxDistance`. There is no continuous dolly.
- `zoomProgress` is what gestures move: 0 at `maxDistance`, 1 at `minDistance`. The wheel moves it by `deltaY`, a pinch by the `ln` of its spread.
- `getZoomRadius()` maps it to the radius.
- Once input pauses (`zoomSettleMs`), `syncZoom()` eases to whichever stop is nearer. So reversing partway cancels a zoom.
- It sustains itself via `dispatchEvent(changeEvent)` → `r3f.invalidate()`, which makes it work in a demand frameloop. The arriving frame dispatches nothing, so the frames can stop.

**The radius is not persistent state.** `update()` re-derives it from `position - target` each frame.
- So zoom must be written inside `update()`.
- Anything that moves the camera itself (e.g. `WorldView.lookAt`) must call `setZoomFromRadius` afterwards, else the next settle undoes it.

**Zooms aim at a point.**
- `setDollyTowards(clientX, clientY)` takes the cursor (wheel) or the pinch centroid.
- `applyZoomTowards(prev, next)` moves the camera along that aim and re-derives `target`.
- Only a **pure** pinch zooms. Two fingers also rotate and pan, so `twoFingerRotateRatio` (the smoothed share of centroid motion) must be under `pinchPurity`.

## Turning

**Turns can pivot on a point.**
- `rotateAbout` names one. `WorldView` gives the zoom crosshair whilst it shows, and nothing whilst following.
- `setRotateAbout` takes it as a turn begins, mouse or touch alike. `update` then slides the whole rig by `slideAboutPivot`.
- Turning about the pivot and about `target` leave `position - target` identical, so they differ by a pure translation. That is all the helper applies.
- With no point named, the turn is about `target`.

## `embodied` mode

**`embodied` restricts what may be steered, by zoom.**

Azimuth:
- Free at every zoom, and untouched by zooming.
- Where the w, a, s and d keys head is set by the view: see [WASD heading](#wasd-heading).
- The older detent, a turn let go snapping to a compass point (`detentEmbodiedAzimuth`), is kept behind `compassSnap`, which nothing sets.
- A drag turns and tilts at once, except whilst the phaser is raised.

Polar:
- Never clamped by the zoom. ONE tilt is tracked, `embodiedPolar`. A zoom neither flattens the view nor tips it back, so both angles survive it.
- A drag owns the polar at every zoom, and `shapeEmbodiedPolar` takes whatever tilt it leaves.
- Entering the mode and a reset set it to the camera's own tilt.

There is no zooming past the outer stop: the radius is only ever a zoom stop.

Whilst the player's phaser is raised (`isAiming`):
- Each turn keeps to one axis, the one its first movement favours, on touch too (`lockTouchRotateAxis`, `pickRotateAxis`).
- Lowering it frees both axes again.

## WASD heading

**The w-key heads along a world axis whenever it can, and where it heads depends on the view alone.** So doors line up without a square view.

Which way (`getWasdDirection`, `syncWasdHeading`, `snapHeading`):
- The w-key heads up the screen, snapped onto the nearest world axis when the view is within `compassSnapRad` (20°) of it. The a, s and d keys are quarter turns from it.
- The arrow keys are read as w, a, s and d (`wasdOfArrow`), so up is the w-key.
- The heading is taken as the first move key goes down (`wasdHeading`), and kept whilst any is held, so a camera turn mid-walk does not swerve them.
- A move key pressed afresh whilst another is held takes the heading again, from the view as it is then (`onKeyDown`). So after a camera turn, a tap re-aims.

Whilst a `wasd_delta` runs (`isWasdDriven`: it asked `getWasdDirection` within `wasdAlign.drivenMs`):
- A held move key turns the view towards the nearest axis, until just within 20° of it (`alignWasdAzimuth`). No further: the view keeps its slant.
- Till then the heading is not kept: the w-key heads up the screen, curving gently as the view turns. Once the view is within 20° it snaps onto the axis, and is kept.
- So a given view always ends heading the same way, never depending on the way before.
- The turn is quick, slowing as it nears: its speed is what is left over `wasdAlign.secs`, between `minRadPerSec` and `maxRadPerSec`. Each frame's step goes through `sphericalDelta.theta`, divided by the damping.
- A drag or a `lookAt` comes first. Letting go stops the turn where it got to.

The HUD:
- On desktop the compass names `compassPoint`, the point nearest the w-key's heading (N is -z), white whilst snapped onto it (`wasdSnapped`). A marker on its rim shows where the w-key heads on screen (`wasdSkew`): amber and leaning whilst snapped, else straight up.

## Following the player

Whilst following, the view frames the player and their frontier: the furthest point ahead that they can see.

**Turning it on**
- `follow` is on or off (`setFollow`). The button, or `v`, toggles it.
- `holdFrontier` (MCP's way to show the player) frames them the same way without the follow. It is a `lookAt` tracking the goal, and `frontierHold` keeps it running until the camera is next touched (`onCameraStart`).

**The frontier**
- `service/player-frontier` reads it off the light sweep. A fan of the sweep's polar table, either side of where their head faces, is read back off the GPU (`playerLight.readTable`) into one kept `ReadbackBuffer`.
- One read is in flight at a time, at most one per `frontierConfig.readMinMs`. A read asks for a frame only when the reach changes.
- `reach` is the furthest of the fan. `ahead` is the vector to the frontier point, eased at `frontierConfig.smoothRate`.

**What changes it**
- **A look caps it** (`w.player.look`, the distance in force `lookReach()`). The light still limits it: the frontier is the nearer of the two.
  - A right click or two-finger tap sets the distance (`base`). It stays as they walk and turn, until another tap or the hud-toast's "x".
  - `r` held, or recon mode, steers it to the pointer only whilst on (`steer`), then gives it back. `r` steers only once held `rCapMs`, so a tap of it shows nothing.
- **A far look extends it**: Space held with the phaser lowered (`w.player.setFarLook`).
  - It casts to the first wall or door, up to `farLookMetres`, past the light and the outer stop. A hull window ends it too, where the cast leaves the ship (`RaycastResult.out`), and the readout greys, keeping its last number. It follows their facing, or the pointer in recon mode or whilst `r` is held.
  - It casts again (`castFarLook`) once it swings `farRecastRad` or they move `farRecastMetres`. The frontier eases at `frontierConfig.scanRate` meanwhile (`w.player.isScanning`), so a doorway swept past does not jerk the view.
  - It is the look's `far`, in force over `steer` and `base` whilst Space is held. Letting go gives them back.
- **A raised phaser extends it** to at least the red dot, where a shot at no one would land (`w.npcFocus.reachOf`).
- **The hud-toast.** Whilst a cap holds, the bar shows its reach: "look 2m", "recon 2m" in recon mode, "look max" for a far look. A passing distance reads sky blue, steered by `r` or recon mode, or a max look: only the tap's is lime. Its "x" drops the cap and ends recon mode (`w.player.stopLooking`). With the phaser raised the "aim" hud-toast shows the dot's range instead.

**How the view frames it** (`easeFrontier`, in `onCameraFrame`)
- **The pan.** `followPlayer` holds the target `frontierConfig.panFrac` of the way along `ahead`, at every zoom (`getFollowGoal`). The aimed zoom-in heads there too.
- **The offset eases with the zoom**, else the view lunges ahead then pulls back, e.g. as the phaser is raised. It is never longer than wanted, so keeps pace as the frontier draws in. Its direction always eases, so a sweep never snaps it round.
- **The stops sit further out**, as the 30° fov is narrow.
  - `controls.minDistance` eases to the nearest radius that fits the player and their frontier, with `frontierConfig.margin` to spare. It is clamped between `frontierConfig.nearFrac` of the travel and the persisted outer stop. So zoomed in, a follow is as far out as a free look zoomed out.
  - A raised phaser's dot, or a far look, lets it go `frontierConfig.aimOuterScale` past the outer stop.
  - `controls.maxDistance` is that times the persisted stops' ratio (`getFrontierStops`).
  - `t` is measured off the live stop, so a drawn-in view is still fully zoomed out.
  - Not following, both ease back to the persisted stops (`holdFrontier` only pans).
- A `lookAt` in `embodied` carries the stops on its own alpha, so the zoom lands with the pan.
- **On touch** the stops are never drawn in (`getFrontierStops`). A follow only pans, and a pinch zooms continuously between the persisted stops (`freeZoom`), resting wherever it is let go.

**Load, pause and respawn**
- **Until the world has risen** (`w.fold`) and the frontier is read, the stops and offset hold where they are. An early reading can be far off.
- **The saved camera keeps its live stops** (`PersistedCamera.stops`). The controls seed the zoom in them (`openStops`), so a load whilst following opens where it was.
- **Paused**, the World's tick stops, so `onCameraFrame` runs `followPlayer` instead, once the World has run unpaused. A pan under way lands rather than rushing on unpause.
- **A respawn or a switch of player** (`spawned`, `set-player`) calls `onPlayerRespawn`. The frontier is read afresh, and a follow pans there, never quicker than `respawnPanMinMs`.
