# Scenarios

Scenarios in which two or more npcs interact, directed by queries over spots (`docs/spots.md`) and live npc state. Also the characters and conversations they use, edited in the Scenario panel.

A query becomes an interaction when it is asked again, on a tick or an event, and its npcs act on the change.

## The panel: `ui/scenario`

`@npc-cli/ui__scenario` (uiKey `Scenario`), `Scenario.tsx`. `meta.worldKey` names its World (default `world-0`), found by `useWorld`. Without one it still edits. The text zoom buttons (`meta.zoom`) float over its top right corner.

On the left is one list in three sections: **scenarios**, **characters** and **conversations**. Beside it is the entry chosen (`meta.entryKey`): `scenario/{key}`, `character/{slug}` or `talk/{key}`. Wide enough (`wideWidth`, at the text's zoom) the two columns sit side by side and resize (`meta.split`). Narrower, they stack.

## The scenarios

As yet each is a stub in `ui/scenario/src/scenarios.ts`, its card listing its steps.

| Scenario | Npcs | Status |
| --- | --- | --- |
| [Hide and seek](#hide-and-seek) | a seeker, 2-3 hiders | not started |
| [Guard and intruder](#guard-and-intruder) | 2 guards, an intruder | not started |
| [Meeting in secret](#meeting-in-secret) | 2 conspirators, a watcher | not started |
| [Breach and clear](#breach-and-clear) | a squad of 3, those inside | not started |

### Hide and seek

1. **Scatter.** Each hider takes a spot the seeker's spot does not see, preferring cover or a doable. It avoids spots another hider holds or sees.
2. **Search.** The seeker walks to the spot that sees the most spots it has not yet seen. Each spot it then sees is marked seen.
3. **React.** A hider the seeker's next spot would see crouches, if cover hides it from there (`crouchHidden`). Else it sneaks to a spot neither the seeker's spot nor its next one sees.
4. **Found.** Once the seeker sees a hider, it looks at them and says "found you". That hider then searches too.

Queries: `sees`, `crouchHidden`, spots in reach, spots held by npcs, an npc's room and facing.

### Guard and intruder

1. **Post.** The guards take an overwatch pair: two spots which between them see every door of a room, and see each other.
2. **Slip through.** The intruder goes door to door through spots neither guard sees. It waits whilst a guard faces its way.
3. **Alert.** A guard who sees the intruder tells the other, in a speech bubble. The other moves to a spot that sees the intruder's way out.
4. **Standoff.** The guards raise their phasers. The intruder hides behind cover from the nearer guard, or gives up, and both guards walk to them.

Queries: pairs of spots, `seesDoors`, `seesVia` with open doors, a route through spots, facing, who sees whom.

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

| Verb | Does |
| --- | --- |
| `count rob to:10 [every:1]` | Says each number in turn |
| `face rob wall` | Looks towards their spot's nearest occluder. Also an npc or a spot key |
| `hide cal from:rob [away:6] [prefer:cover,corner]` | As `avoid`, judged strictly: every spot it will count as at must be unseen, with its room's doors open, as it opens one going in and may stand by one. So it goes further than `avoid` |
| `avoid cal from:rob [away:6] [prefer:cover,corner]` | To a spot none of them sees, `away` metres from them if one is, judged by that spot alone. Skips spots others stand at or head for. Already unseen, it stays put. Sat or lain, it first gets up beside its seat or bed. Blocked, it tries another, failing after 3. Seen on arrival, it fails saying why, e.g. which of its spots may be seen |

A walk that stalls, e.g. blocked by the player, is given up.

`sees rob abe cal` says whom `rob` sees: their spots in sight, eyes open, within 60° of facing, and not crouched behind cover. `sees --all abe ben cal` gives each ordered pair `a b` where `a` sees `b`. `--los` asks for line of sight alone, ignoring eyes and facing, e.g. `sees --los --all abe ben`. Both exit 1 if none, for `if` and `while`.

## Characters

Authored in DEV and shipped as data. One JSON file per character, `packages/media/src/scenario/character/{slug}.json`, its key `character/{slug}`. `ScenarioEntrySchema` (`ui/world/src/scenario.schema.ts`) has `name`, `npcKey`, `skin`, and `maps`: what they have in the World (below). `scenarioKinds` is `character` alone, as yet.

`scripts/src/vite-plugin-scenario.ts` provides them, as `jobsExamplesPlugin` does its examples:

| | DEV | production |
|---|---|---|
| read | `GET /api/scenario`, every entry by key | `virtual:scenario`, bundled |
| write | `POST` / `DELETE /api/scenario/file/{kind}/{slug}`, zod-checked | read-only |
| change | the watcher sends `scenario-changed`, and the panel reloads | |

A key must be a known kind and a `[a-z0-9-]` slug, which is what keeps a write inside the folder. The DEV endpoints load the schema with `ssrLoadModule`, so a schema edit needs no restart. An edit to the plugin itself does.

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

## Conversations

Generic sci-fi as yet, to be moved to the SCP setting. Conversations are terse: lines of one to five words, to be decoded, not read.

A `Conversation` (`ui/world/src/service/talk.ts`, imported as `@npc-cli/ui__world/talk`) is two-party: `nodes` by id, each the npc's `text` and `topic`, and the player's `choices` (`text`, `to`, `needs`). None is an ending. It is a graph, as choices lead back. As yet the trees are ten short hand-written demos, `ui/scenario/src/demo/trees.ts` (an airlock guard, a medic, a quartermaster...). An emoji is inline, and only where it explains the word before it (`Cells 🔋.`) or stands for a word (`👍.`).

A conversation's card (`ConversationCard.tsx`) outlines its tree (`toOutline`). Each node is unfolded once, under the parent a breadth-first walk meets it by, so nearest the start. Elsewhere it is a reference. A row is the choice, then what is said back, with its needs as neutral pips. The box finds a line, topic or id. The count flags a choice leading nowhere, or a line nothing leads to. **the player talks to** an npc starts it in the World: `w.speech.startTalk(conv, npcKey)`.

### Played in the World: `WorldSpeech`

`WorldSpeech` is a button, marked when something was said since its history was last open, and that history, grouped into threads by who spoke and to whom (`threadKeyOf`). A plain `w.speech.say` is a thread of one; a talk is the player's and the npc's. `say` takes `to`, which the `speech` event carries, so a client's history groups alike. A thread is drawn by `TalkThread` (`@npc-cli/ui__world/talk-thread`, styled by `talk-thread.css`): speech bubbles, the player's on the right, an npc's tinted by topic (`topicHue`) with a rule naming each topic turned to. A reply and its answer share a row. Only the latest row and the one before, dimmed, show; the rest fold into an ellipsis until clicked, and a click on the latest folds them again.

Every line said also shows over the speaker's head: ONE bubble per npc (`NpcBubbles`, through `w.html`, bare: click-through, no handles). Its debug section (room, pose, and for the player `BreathControls`) opens on right-click with **contextmenu** on in the debug **npcs** select, or from the speech menu's **debug** (`w.bubble.openDebug`). Its close button closes that section alone. A talk's line awaiting an answer is `hold`: it stays until someone it addresses speaks (`release`), then runs `lineSecs` of world time, as any other line does.

A talk (`talks`, by thread) offers the replies of the line replied to, under it. Each waits on its `needs`, drawn as pips, green once met (`talkNeeds`): `near` (within `talkConfig.nearDist`), `facing` (within `facingArc` of straight ahead), `psi` (the player's psi raised). Not all green, the reply cannot be said. `onTick` looks again every `needsPollSecs` whilst the panel is open, and re-renders only on a change. A reply said, the npc answers after `answerSecs` of world time, so never whilst paused.

A thread may also hold THOUGHTS, an npc's and not said: see `docs/psi.md`.

Nothing is lost going back: a click on an earlier line of the npc's has them say it again, at the foot of the thread, to be answered there. A talk whose npc is gone keeps its history, and offers nothing. Talks are the panel's own state, unsaved, with no variables as yet.
