# Lore

Characters and conversations, authored in DEV and shipped as data. Generic sci-fi, no fixed setting.
Conversations are terse: lines of one to five words, to be decoded, not read.

## Data

One JSON file per character, `packages/media/lore/character/{slug}.json`, its key `character/{slug}`.
`LoreEntrySchema` (`ui/manifest/src/lore.schema.ts`) has `name`, `npcKey`, `skin`, and `maps`: what
they have in the World (below). `loreKinds` is `character` alone, as yet.

`scripts/src/vite-plugin-lore.ts` provides them, as `jobsExamplesPlugin` does its examples:

| | DEV | production |
|---|---|---|
| read | `GET /api/lore`, every entry by key | `virtual:lore`, bundled |
| write | `POST` / `DELETE /api/lore/file/{kind}/{slug}`, zod-checked | read-only |
| change | the watcher sends `lore-changed`; the pane reloads | |

A key must be a known kind and a `[a-z0-9-]` slug, which is what keeps a write inside the folder.

## The panel: `ui/manifest`

`@npc-cli/ui__manifest` (uiKey `Manifest`), a panel of its own: `Manifest.tsx`. `meta.worldKey`
names its World (default `world-0`), found by `useWorld`; without one it still edits. The text zoom
buttons (`meta.zoom`) float over its top right corner.

On the left, the characters and the conversations; beside them, the one chosen (`meta.entryKey`:
`character/{slug}`, or `talk/{key}`). Wide enough (`wideWidth`, at the text's zoom) the two sit side
by side and resize (`meta.split`); narrower, they stack. A character's card (DEV only to edit; an
edit saves itself `autosaveMs` after the last keystroke) has name, npc, skin and keys.

Keys are typed into ONE box (`KeyBox`), with a World: a room's (`g0r1`) or a door's (`g0d29`) on
this map, ended by a space, comma, enter, paste or blur. Each becomes a badge
once it is found to exist; what is not stays typed, and the box goes red. Backspace in the empty box
takes the last badge off. A badge whose key this map lacks is red.

Selecting a character centres a Decorator's map on their npc, else their first room; choosing an
npc on that map shows the character whose `npcKey` they are. Both go through `manifestShared` (`shared.ts`), a
small store keyed by `worldKey` — `entry`, `npcKey`, `locate`, `renamed` — so neither panel imports
the other, and either may be absent.

## Conversations

A `Conversation` (`ui/world/src/service/talk.ts`, imported as `@npc-cli/ui__world/talk`) is
two-party: `nodes` by id, each the npc's `text` and `topic`, and the player's `choices` (`text`,
`to`, `needs`); none is an ending. It is a graph, as choices lead back. As yet the trees are ten
short hand-written demos, `ui/manifest/src/demo/trees.ts` (an airlock guard, a medic, a
quartermaster...). An emoji is inline, and only where it explains the word before it (`Cells 🔋.`)
or stands for a word (`👍.`).

A conversation's card (`ConversationCard.tsx`) outlines its tree (`toOutline`): each node unfolded once, under the parent a
breadth-first walk meets it by, so nearest the start; elsewhere a reference. A row is the choice,
then what is said back, with its needs as neutral pips. The box finds a line, topic or id; the count
flags a choice leading nowhere, or a line nothing leads to. **the player talks to** an npc starts it
in the World: `w.speech.startTalk(conv, npcKey)`.

### Played in the World: `WorldSpeech`

The speech history is grouped into threads by who spoke and to whom (`threadKeyOf`): a plain
`w.speech.say` is a thread of one, a talk is the player's and the npc's. `say` takes `to`, which the
`speech` event carries, so a client's history groups alike. A thread is drawn by `TalkThread`
(`@npc-cli/ui__world/talk-thread`, styled by `talk-thread.css`): speech bubbles, the player's on the
right, an npc's tinted by topic (`topicHue`) with a rule naming each topic turned to. A reply and its
answer share a row; only the latest row and the one before, dimmed, show, the rest folded into an
ellipsis until clicked — and a click on the latest folds them again.

A talk (`talks`, by thread) offers the replies of the line replied to, under it. Each waits on its
`needs`, drawn as pips, green once met — `talkNeeds`: `near` (within `talkConfig.nearDist`),
`facing` (within `facingArc` of straight ahead), `psi` (psi targeting them). Not all green, the
reply cannot be said. `onTick` looks again every `needsPollSecs` whilst the panel is open, and
re-renders only on a change. A reply said, the npc answers after `typingMs`.

Nothing is lost going back: a click on an earlier line of the npc's replies to it again (`from`,
outlined), and whatever is said next is appended. A talk whose npc is gone keeps its history, and
offers nothing. Talks are the panel's own state, unsaved; no variables as yet.

## In the World

A character has, per map, `maps[mapKey].rooms` (grKeys) and `.doors` (the gdKeys they hold keys
to), as a `g0r21` means nothing on another; both are entered in the card's key box.

- The Decorator's map outlines the shown character's rooms and doors (`ui/decorator/src/ManifestLoreLayer.tsx`).
- Its **npcs** menu lists every character with an npc (`useManifestLoreCharacters`); choosing one puts them
  where the map is next clicked (`Editor.spawnNpc`): spawned or moved, in their skin, and granted
  their doors.
- Editing `npcKey` (committed on enter or blur) removes their npc and adds it back under the new
  key where they stood, keeping their doors; clearing it only removes. Editing `skin` reskins them.

The DEV endpoints load the schema with `ssrLoadModule`, so a schema edit needs no restart; an edit to
the plugin itself does.
