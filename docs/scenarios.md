# Scenarios

Scenarios in which two or more npcs interact, directed by queries over spots (`docs/spots.md`) and live npc state. Also the characters and conversations they use, edited in the Scenario panel.

A query becomes an interaction when it is asked again, on a tick or an event, and its npcs act on the change.

## The panel: `ui/scenario`

`@npc-cli/ui__scenario` (uiKey `Scenario`), `Scenario.tsx`. `meta.worldKey` names its World (default `world-0`), found by `useWorld`. Without one it still edits. The text zoom buttons (`meta.zoom`) float over its top right corner.

On the left is one list in four sections: **scenarios**, **characters**, **routes** and **conversations**. Beside it is the entry chosen (`meta.entryKey`): `scenario/{key}`, `character/{slug}`, `route/{slug}` or `talk/{key}`. Wide enough (`wideWidth`, at the text's zoom) the two columns sit side by side and resize (`meta.split`). Narrower, they stack.

## The scenarios

As yet each is a stub in `ui/scenario/src/scenarios.ts`, its card listing its steps.

| Scenario | Npcs | Status |
| --- | --- | --- |
| [Hide and seek](#hide-and-seek) | a seeker, 2-3 hiders | not started |
| [Guard and intruder](#guard-and-intruder) | 2 guards, an intruder | started: [routes](#routes) |
| [Meeting in secret](#meeting-in-secret) | 2 conspirators, a watcher | not started |
| [Breach and clear](#breach-and-clear) | a squad of 3, those inside | not started |

### Hide and seek

1. **Scatter.** Each hider takes a spot the seeker's spot does not see, preferring cover or a doable. It avoids spots another hider holds or sees.
2. **Search.** The seeker walks to the spot that sees the most spots it has not yet seen. Each spot it then sees is marked seen.
3. **React.** A hider the seeker's next spot would see crouches, if cover hides it from there (`crouchHidden`). Else it sneaks to a spot neither the seeker's spot nor its next one sees.
4. **Found.** Once the seeker sees a hider, it looks at them and says "found you". That hider then searches too.

Queries: `sees`, `crouchHidden`, spots in reach, spots held by npcs, an npc's room and facing.

### Guard and intruder

1. **Patrol.** Each guard walks a [route](#routes), stopping at each point to look either side (`act guard`).
2. **Slip through.** The intruder goes door to door through spots neither guard sees. It waits whilst a guard faces its way.
3. **Alert.** A guard who sees the intruder tells the other, in a speech bubble. The other moves to a spot that sees the intruder's way out.
4. **Standoff.** The guards raise their phasers. The intruder hides behind cover from the nearer guard, or gives up, and both guards walk to them.

Queries: pairs of spots, `seesDoors`, `seesVia` with open doors, a route through spots, facing, who sees whom.

#### Patrolling: `act guard`

`act guard route:test-route [npcs]` walks a [route](#routes), else `path:<points>` or `cycle:<points>` unsaved. The npcs follow as `g1,g2`, else the route's `npcKey`, else `guard-0`. Those absent are spawned at their start in an `mtf` skin. Several are spaced evenly by length: round a cycle, else along a path there and back, so on a path they pass each other.

One loop (`patrol`) ticks every 0.25 game seconds for all of them, so a kill or a pause holds them together. Each guard is in a phase:

| Phase | |
| --- | --- |
| `walk` | To their next point. A stall is given up: they skip that point, saying so |
| `stop` | `stop.secs` facing the way they came. At a path's end, nothing more |
| `left`, `right` | `stop.lookSecs` each, `stop.lookDeg` either side of that way |
| `halt` | Facing whom they saw, until 3 s unseen. Then they walk to their nearest point and go on |

A cycle wraps round, and a path turns back at either end. A psi distract ends a guard's `stop`, `left` or `right` early.

Each tick they look for whom they watch (`watch`, else the player) with `perceive`, as `sees` does. A sighting emits `guard-spotted` (`npcKey`, `seen`, `route`), again only after 3 s unseen. Then they halt and say `say` for 3 s (`guardSaySecs`). With `say` empty (`say:""`) they walk on silent, leaving the sighting to a script: `events 'e => e.key === "guard-spotted"' | …`.

#### So far

Step 1 is built, and the start of step 3.

- **Routes** are scenario entries, one file each, with the map's key inside. jsh `sc` lists, gets, saves and removes them. See [Routes](#routes).
- **`act guard`** patrols one, with one npc or several, and halts on a sighting.
- **The Decorator** lists this map's routes, draws the chosen one, and in DEV edits it. See Routes in `docs/decorator.md`.
- **`guard-spotted`** lets a script react instead of the halt (`say:""`).
- **Sight is stricter** between npcs: a spot's `always` counts only for an npc within 0.3 m of it, else lines decide (`docs/perception.md`).

This replaced an earlier `act guard room:<grKey>`, which posted guards on spots that between them saw a room's doors. Routes say where guards walk, rather than covering a room for them.

#### Future work

- **Follow edits.** A running `act guard` reads its route once. It could re-read it on `scenario-changed`: re-aim each guard at their point if it moved, else at the nearest.
- **A halt that ends.** A guard halts until 3 s after losing sight, so someone always in view holds them for good. Give it a limit, or step closer.
- **Alert** (step 3, the rest). On `guard-spotted`, the guard tells the others in speech, and one moves to see the intruder's way out.
- **The intruder** (step 2). Spots unseen along their way, waiting whilst a guard faces it, from the guards' routes and phases.
- **Per-point stops.** How long to stop, and how far to look, at each point.
- **Spacing kept.** Several guards drift together after a halt or a stall. They could slow or wait to keep their spacing.
- **Routes in the Decorator:** making and removing them, and undo for their edits.
- **An in-World overlay** of routes, as the spots overlay.

### Meeting in secret

1. **Choose a place.** Two spots, near each other and in sight of each other, that the watcher's spot does not see. Doables are preferred, so they sit and talk.
2. **Arrive apart.** Each takes a route the watcher does not see, and they arrive at different times.
3. **Lookout.** Whilst one talks, the other stands at a spot that sees the door the watcher would come through.
4. **Scatter.** When the watcher heads for a spot that sees them, the lookout warns the talker. They leave by different doors to spots hidden from the watcher, then walk calmly back to their posts.

Queries: spots near doables, pairs in sight of each other, the watcher's room and heading, `seesDoors`, spots hidden from the watcher.

### Breach and clear

1. **Stack up.** One door spot each on the near side of the room's door, close together, and hidden from the inside (`seesVia`).
2. **Entry.** The door opens. The first npc takes the corner spot that sees most of the room, and the second the opposite corner. Neither crosses the other's line of sight.
3. **Clear.** Spots no squad member sees yet, e.g. behind obstacles, are each sent the nearest free member. An npc found inside is told to sit or crouch, with psi or the phaser raised.
4. **Hold.** Once every spot of the room is seen by someone, one member watches the door and the rest gather.

Queries: spots by side of a door, coverage (the union of `sees`), the spot seeing most, the nearest free npc, a room's spots.

### Queries they share

- **Npc to spot:** `spotOf(npc)`, and their room and facing.
- **Sight between spots:** `sees`, `seesVia` given which doors are open, `seesDoors`, `crouchHidden`.
- **Sets of spots:** in reach or in a room, coverage, not yet seen, held by other npcs.
- **Picking:** nearest, most new coverage, pairs that meet a condition.
- **Live checks:** who sees whom now, and a reaction when it changes.

## Acts: jsh `act`

The pieces of a scenario, played by hand rather than directed. `act <verb> <npc> …` (`cli/src/jsh/world/act.ts`) runs one on game time until done or killed. Run several as background jobs (`&`) to compose them. `from` names npcs, comma-separated. `rooms` limits the spots, else the whole map.

Npc first, a verb takes its main option as `<verb>:<value>`: `act kate avoid:rob` is `act avoid kate from:rob`, as are `hide:rob` (`from:rob`), `nudge:rob` (`from:rob`), `face:g0r12-3` and `count:10` (`to:10`). Other options follow, e.g. `act kate avoid:rob away:3`. `park` and `pad` take several npcs, comma-separated, planned together: `act park rob,kate`.

| Verb | Does |
| --- | --- |
| `count rob [from:1] [to:10] [every:1] [down]` | Says each number from `from` to `to`, either way. `from:3` alone counts down to 1, as does `down` from `to` |
| `face rob wall` | Looks towards their spot's nearest occluder. Also an npc or a spot key |
| `hide cal from:rob [away:6] [prefer:cover,corner]` | As `avoid`, judged strictly: every spot it will count as at must be unseen, with its room's doors open, as it opens one going in and may stand by one. So it goes further than `avoid` |
| `avoid cal from:rob [away:6] [prefer:cover,corner]` | To a spot none of them sees, `away` metres from them if one is, judged by that spot alone. Skips spots others stand at or head for. Already unseen, it stays put. Sat or lain, it first gets up beside its seat or bed. Blocked, it tries another, failing after 3. Seen on arrival, it fails saying why, e.g. which of its spots may be seen |
| `park rob,kate` | Against a nearby wall, clear of its corners, the room's doorways and others parked: they fade there, or turn if already there. Marked parked (`pred.ts`). One with no clear spot stays put and is named in the error |
| `pad kate [by:1]` | Where there is room to walk right round them, `by` metres (`standConfig.padClearance`) from walls, doorways and others. Marked padded. One with no room is named in the error, e.g. `not padded: kate` |
| `guard route:test-route [g1,g2] [watch:rob,kate] [say:Stop!] [secs:2] [lookSecs:2] [lookDeg:60]` | Walks a route until killed, stopping at each point to look either side, else `path:<points>` or `cycle:<points>`. Options replace the route's. See [Patrolling](#patrolling-act-guard) |
| `nudge kate [from:rob] [by:0.5]` | Walks `by` metres away from `from`, an npc or a point, else a random way, slid along the navmesh so a wall or a door they cannot pass stops them |

A walk that stalls, e.g. blocked by the player, is given up.

An act pauses with the World, as any world command (`docs/jsh-pause.md`). Paused by hand or by the Jsh pane, the npc stops, and walks or looks on once resumed. `park` and `pad` let a fade finish instead, as stopping one would leave them invisible. Its waits count only whilst it runs, through its `Task` (`docs/tasks.md`). A kill stops every npc it moves.

`sees rob abe cal` says whom `rob` sees: their spots in sight, eyes open, within 60° of facing, and not crouched behind cover. `sees --all abe ben cal` gives each ordered pair `a b` where `a` sees `b`. `--los` asks for line of sight alone, ignoring eyes and facing, e.g. `sees --los --all abe ben`. Both exit 1 if none, for `if` and `while`.

## Characters

Authored in DEV and shipped as data. One JSON file per character, `packages/media/src/scenario/character/{slug}.json`, its key `character/{slug}`. `ScenarioEntrySchema` (`ui/world/src/scenario.schema.ts`) is a union by `kind`, of `character` and [`route`](#routes). A character has `name`, `npcKey`, `skin`, and `maps`: what they have in the World (below).

`scripts/src/vite-plugin-scenario.ts` provides them, as `jobsExamplesPlugin` does its examples:

| | DEV | production |
|---|---|---|
| read | `GET /api/scenario`, every entry by key | `virtual:scenario`, bundled |
| write | `POST` / `DELETE /api/scenario/file/{kind}/{slug}`, zod-checked | read-only |
| change | the watcher sends `scenario-changed`, and the panel reloads | |

A key must be a known kind and a `[a-z0-9-]` slug, which is what keeps a write inside the folder. The DEV endpoints load the schema with `ssrLoadModule`, kinds included, so a schema edit needs no restart. An edit to the plugin itself does.

The schema and the loader live in `ui/world` (`scenario.schema.ts`, `service/scenario-shared.ts`), so the Decorator uses them without depending on the panel.

### The card

A character's card has name, npc, skin and keys. It is editable in DEV only, and an edit saves itself `autosaveMs` after the last keystroke.

Keys are typed into ONE box (`KeyBox`), with a World: a room's (`g0r1`) or a door's (`g0d29`) on this map, ended by a space, comma, enter, paste or blur. Each becomes a badge once it is found to exist. What is not stays typed, and the box goes red. Backspace in the empty box takes the last badge off. A badge whose key this map lacks is red.

### In the World

A character has, per map, `maps[mapKey].rooms` (grKeys) and `.doors` (the gdKeys they hold keys to), as a `g0r21` means nothing on another map. Both are entered in the card's key box.

- The Decorator's map outlines the shown character's rooms and doors (`ui/decorator/src/CharacterLayer.tsx`).
- Its **npcs** menu lists every character with an npc (`useScenarioCharacters`). Choosing one puts them where the map is next clicked (`Editor.spawnNpc`): spawned or moved, in their skin, and granted their doors.
- Selecting a character centres the Decorator's map on their npc, else their first room. Choosing an npc on that map shows the character whose `npcKey` they are.
- Both go through `scenarioShared`, a small store keyed by `worldKey` (`entry`, `npcKey`, `locate`, `renamed`). Neither panel imports the other, and either may be absent.
- Editing `npcKey` (committed on enter or blur) removes their npc and adds it back under the new key where they stood, keeping their doors. Clearing it only removes. Editing `skin` reskins them.

## Routes

A way a guard walks, on one map. One JSON file each, `packages/media/src/scenario/route/{slug}.json`, saved and served as characters are. The Scenario panel lists every map's by name, and shows one chosen (`RouteCard`): its fields and points, read-only. The Decorator edits them.

| Field | Default | |
| --- | --- | --- |
| `mapKey` | | The map its points are on |
| `points` | | Floor points `[x, y]`, at least 2 |
| `cycle` | `false` | Back to the first after the last, else back and forth |
| `npcKey` | `guard-0` | Who walks it |
| `watch` | `[]` | Who they watch for: none listed is the player |
| `say` | `"Halt!"` | Said on seeing one, halting. Empty, they neither halt nor speak: a script reads `guard-spotted` |
| `stop` | `{ secs: 2, lookSecs: 2, lookDeg: 60 }` | Seconds stopped at each point, then looking each way, and how far |

jsh `sc` (`packages/cli/src/jsh/world/scenario.ts`) reads and writes them:

| | |
| --- | --- |
| `sc ls route`, `sc list route` | This map's routes, a line each. `--all` for every map's. `sc ls character` lists characters |
| `sc get route/basic-route` | The entry, as a value |
| `sc save route/basic-route path:$( pick 3 ) [cycle] [npc:guard-0] [watch:rob,kate] [say:Stop!]` | DEV. Points are pick events, `[x, y]` or spot keys, snapped onto the navmesh to the cm, on this map. `cycle:<points>` is a cycle. Saved over, a route keeps what is not given |
| `sc rm route/basic-route` | DEV |

`act guard route:basic-route` walks one: see [Patrolling](#patrolling-act-guard). The Decorator's route tab lists this map's, draws the chosen one, and in DEV edits its points: see Routes in `docs/decorator.md`.

## Conversations

Generic sci-fi as yet, to be moved to the SCP setting. Conversations are terse: lines of one to five words, to be decoded, not read.

A `Conversation` (`ui/world/src/service/talk.ts`, imported as `@npc-cli/ui__world/talk`) is two-party: `nodes` by id, each the npc's `text` and `topic`, and the player's `choices` (`text`, `to`, `needs`). None is an ending. It is a graph, as choices lead back. As yet the trees are ten short hand-written demos, `ui/scenario/src/demo/trees.ts` (an airlock guard, a medic, a quartermaster...). An emoji is inline, and only where it explains the word before it (`Cells 🔋.`) or stands for a word (`👍.`).

A conversation's card (`ConversationCard.tsx`) outlines its tree (`toOutline`). Each node is unfolded once, under the parent a breadth-first walk meets it by, so nearest the start. Elsewhere it is a reference. A row is the choice, then what is said back, with its needs as neutral pips. The box finds a line, topic or id. The count flags a choice leading nowhere, or a line nothing leads to. **the player talks to** an npc starts it in the World: `w.speech.startTalk(conv, npcKey)`.

### Played in the World: `WorldSpeech`

`WorldSpeech` is a button, marked when something was said since its history was last open, and that history, grouped into threads by who spoke and to whom (`threadKeyOf`). A plain `w.speech.say` is a thread of one; a talk is the player's and the npc's. `say` takes `to`, which the `speech` event carries, so a client's history groups alike. A thread is drawn by `TalkThread` (`@npc-cli/ui__world/talk-thread`, styled by `talk-thread.css`): speech bubbles, the player's on the right, an npc's tinted by topic (`topicHue`) with a rule naming each topic turned to. A reply and its answer share a row. Only the latest row and the one before, dimmed, show; the rest fold into an ellipsis until clicked, and a click on the latest folds them again.

Every line said also shows over the speaker's head: ONE click-through bubble per npc (`NpcBubbles`), pinned over them each frame. Their menu (room, pose, items, and for the player `BreathControls`) is a `PickMenu`. It opens on right-click with the debug **context menu** on, or from the speech menu's **debug** (`w.pickMenu.toggle`). A talk's line awaiting an answer is `hold`: it stays until someone it addresses speaks (`release`), then runs `lineSecs` of world time, as any other line does.

A talk (`talks`, by thread) offers the replies of the line replied to, under it. Each waits on its `needs`, drawn as pips, green once met (`talkNeeds`): `near` (within `talkConfig.nearDist`), `facing` (within `facingArc` of straight ahead), `psi` (the player's psi raised). Not all green, the reply cannot be said. `onTick` looks again every `needsPollSecs` whilst the panel is open, and re-renders only on a change. A reply said, the npc answers after `answerSecs` of world time, so never whilst paused.

A thread may also hold THOUGHTS, an npc's and not said: see `docs/psi.md`.

Nothing is lost going back: a click on an earlier line of the npc's has them say it again, at the foot of the thread, to be answered there. A talk whose npc is gone keeps its history, and offers nothing. Talks are the panel's own state, unsaved, with no variables as yet.
