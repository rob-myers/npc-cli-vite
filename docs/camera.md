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
- `w` heads up the screen, snapped onto a world axis within `compassSnapRad` (20°) of it (`snapHeading`, `getWasdDirection`). So doors line up without a square view, and a view near a diagonal walks diagonally, as seen.
- That heading is held whilst any of `w`, `a`, `s` and `d` is down (`wasdHeading`), so a turn mid-walk doesn't swerve them.
- On desktop the HUD's compass names `compassPoint`, the point nearest `w`'s heading (N is -z), white whilst snapped onto it (`wasdSnapped`). A marker on its rim shows where `w` heads on screen (`wasdSkew`): amber and leaning whilst snapped, else straight up.
- The older detent, a turn let go snapping to a compass point (`detentEmbodiedAzimuth`), is kept behind `compassSnap`, which nothing sets.
- Zoomed out (`t > embodiedAxisLockFrom`), a drag locks to one axis.

Polar:
- Never clamped by the zoom. ONE tilt is tracked, `embodiedPolar`. A zoom neither flattens the view nor tips it back, so both angles survive it.
- A drag owns the polar at every zoom, and `shapeEmbodiedPolar` takes whatever tilt it leaves.
- Entering the mode and a reset set it to the camera's own tilt.

There is no zooming past the outer stop: the radius is only ever a zoom stop.

## Following the player

**Zoomed out, the view frames the player and their frontier.**
- `service/player-frontier` reads a fan of the light sweep's polar table back off the GPU (`playerLight.readTable`), into one kept `ReadbackBuffer`. One read is in flight at a time, and at most one per `frontierConfig.readMinMs`.
- It keeps the furthest as `reach`. `ahead` is the vector to the frontier point.
- With the phaser raised it reaches at least as far as the red dot, where a shot at no one would land (`w.npcFocus.reachOf`). The inner stop may then go `frontierConfig.aimOuterScale` past the outer stop, to fit the dot in view.
- `followPlayer` holds the target `frontierConfig.panFrac` of the way along it, at every zoom (`getFollowGoal`). The aimed zoom-in heads there too.

**Follow**
- `follow` is on or off (`setFollow`). The button, or `v`, toggles it.
- `holdFrontier` (MCP's way to show the player) is a `lookAt` tracking the goal. Then `frontierHold` keeps the follow running until the camera is next touched (the controls' `start` event, see `onCameraStart`).
- A `lookAt` in `embodied` carries the stops on its own alpha, so the zoom lands with the pan.
- A player respawn (`spawned`, e.g. `fadeSpawn`) or a switch of player (`set-player`) calls `onPlayerRespawn`. The frontier is read afresh, and a follow pans there, never quicker than `respawnPanMinMs`.

**Following, the stops sit further out** (`easeFrontier`, in `onCameraFrame`), as the 30° fov is narrow:
- `controls.minDistance` eases to the nearest radius that fits the segment in the frustum with `frontierConfig.margin` to spare. It is clamped between `frontierConfig.nearFrac` of the travel and the persisted OUTER stop. So zoomed in, a follow is as far out as a free look zoomed out.
- `controls.maxDistance` is that times the persisted stops' ratio (`getFrontierStops`).
- Both go back to persisted when not following (`holdFrontier` only pans), or when there is nothing to read.
- `t` is measured off the live stop, so a drawn-in view is still fully zoomed out.
- On TOUCH the stops are never drawn in (`getFrontierStops`). A follow only pans, and a pinch zooms continuously between the persisted stops (`freeZoom`), resting wherever it is let go.
