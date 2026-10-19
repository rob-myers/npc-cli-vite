# Spirit

The ONLY doc for the player leaving their body and waking in another: `components/Spirit.tsx` (`w.spirit`).

## Trigger

"Become", offered by npc focus whilst psi is raised, leaves for whom it is open on (`w.spirit.start`). jsh
`spirit [npcKey]` does the same, else finds someone. `q` only raises and lowers psi.

## Phases

- **leave** (`leaving`): follow is turned off and the zoom held (`zoomHeld`) until they arrive (`handBack`). The camera pans onto their forehead, turned to the side their face is on as far as the compass
  dial allows (`frame`, `lookAt`'s `theta`). The light draws in to nothing at their forehead (`foreheadOf`, through the head bone), and the unseen goes black
  (`playerLight.setVeil`), but not in `ship` mode (`veil`). A breath under way
  is let finish, and the pause after it drawn out (`breath.pace`). Their eyes shut halfway.
- **commit**: who to wake in, `findTarget`: anyone sitting or lying, else someone spawned in a free bed, else a
  free seat (`sleeper-N`).
  The route curves forehead to forehead along the navmesh's own path (navcat `findPath`, any door), else through the
  middle of each door between their rooms (`w.e.findPathAsync`). Curved by `smoothRoute`.
- **cross**: a spark runs the route with a thread behind it (`createTrail`). The light stands at the spark
  (`w.spirit.light`, read by `LightSweep`) with a little reach, a plain circle lit alike through walls and doors (`setVeil`'s `plain`), and the camera rides it (`lookAt`'s `along`), restarted by `followSpark` should anything end it.
  A drag takes the view meanwhile, and once let go it is eased back onto the spark, at the angle left.
  It leaves one chest and settles on the other (`riseAt`), so a bunk at either end is met at its height.
  `sight` shows only the player's rooms, so each on the route is lit by hand until they wake, `roomLeadMetres`
  before the spark enters it (`findRoomsAlong`): it has faded in by the time the spark arrives.
- **arrive**: they are made the player with psi raised, without the switch's own pan (`assign`'s `pan: false`).
  The view is handed back at once: a follow that was on before resumes.
  The camera kept its height throughout, so nothing moves but a follow easing towards the frontier. Their first breath is from empty, slow and swollen
  (`breath.swell`), and the light opens out with it, settling back from
  their forehead to their feet. Their eyes open, blinking, once it is drawn.

Tuned by `spiritConfig` in `Spirit.tsx`.
