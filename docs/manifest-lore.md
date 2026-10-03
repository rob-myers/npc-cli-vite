# Lore

Backstories and conversations for **NPC CLI: Low Berth**, authored in DEV and shipped as data. The
setting is itself an entry (`setting/low-berth`): a loose backdrop for many small scenarios, not a
plot. Everything is terse: sentences of one to five words, to be decoded, not read.

## Data

One JSON file per entry, `packages/media/lore/{kind}/{slug}.json`, its key `{kind}/{slug}`. Kinds:
`setting`, `level`, `place`, `faction`, `character`. `LoreEntrySchema`
(`ui/manifest/src/lore.schema.ts`) has `title`, `summary`, `backstory`, `voice`, `facts`, `links`
(other entries it is tied to), and what it has in the World (below).

`scripts/src/vite-plugin-lore.ts` provides them, as `jobsExamplesPlugin` does its examples:

| | DEV | production |
|---|---|---|
| read | `GET /api/lore`, every entry by key | `virtual:lore`, bundled |
| write | `POST` / `DELETE /api/lore/file/{kind}/{slug}`, zod-checked | read-only |
| change | the watcher sends `lore-changed`; the pane reloads | |

A key must be a known kind and a `[a-z0-9-]` slug, which is what keeps a write inside the folder.

## The panel: `ui/manifest`

`@npc-cli/ui__manifest` (uiKey `Manifest`), a panel of its own: `Manifest.tsx`. `meta.worldKey`
names its World (default `world-0`), found by `useWorld`; without one it still edits. **lore** and
**talk** beside the text zoom buttons (`meta.zoom`) switch it (`meta.tab`).

**lore**: entries by kind, and a card to edit (DEV only; an edit saves itself `autosaveMs` after
the last keystroke). Wide enough (`wideWidth`, at the text's zoom) the two sit side by side and
resize (`meta.split`); narrower, they stack. The card is three sections, each folding under its
header (`meta.folded`), which then says what it holds: **about** (title, summary, facts), **world**
(npc, skin, keys) and **story** (backstory, voice).

Keys are typed into ONE box (`KeyBox`): a room's (`g0r1`) or a door's (`g0d29`) on this map, or
another entry's (`place/dock`), ended by a space, comma, enter, paste or blur. Each becomes a badge
once it is found to exist; what is not stays typed, and the box goes red. Backspace in the empty box
takes the last badge off. A badge whose key this map lacks is red.

Selecting an entry centres a Decorator's map on its npc, else its first room; choosing an npc on
that map shows the entry whose `npcKey` they are. Both go through `manifestShared` (`shared.ts`), a
small store keyed by `worldKey` — `entry`, `npcKey`, `locate`, `renamed` — so neither panel imports
the other, and either may be absent.

## Conversations

A `Conversation` (`ui/world/src/service/talk.ts`, imported as `@npc-cli/ui__world/talk`) is
two-party: `nodes` by id, each the npc's `text` and `topic`, and the player's `choices` (`text`,
`to`, `needs`); none is an ending. It is a graph, as choices lead back. As yet the trees are
hand-written demos in `ui/manifest/src/demo/`: `thawed`, and the larger `dog-watch`, whose talk keeps
turning to philosophy. An emoji is inline, and only where it explains the word before it
(`Tam 🤖`) or stands for a word (`🔑.`).

**talk** (`TalkTab.tsx`) outlines a tree (`toOutline`): each node unfolded once, under the parent a
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

An entry has `maps[mapKey].rooms` (grKeys); a character also `npcKey`, `skin` and
`maps[mapKey].doors` (the gdKeys they hold keys to). Per map, as a `g0r21` means nothing on another.
Rooms, doors and `links` are all entered in the card's key box.

- The Decorator's map outlines the shown entry's rooms and doors (`ui/decorator/src/ManifestLoreLayer.tsx`).
- Its **npcs** menu lists every character with an npc (`useManifestLoreCharacters`); choosing one puts them
  where the map is next clicked (`Editor.spawnNpc`): spawned or moved, in their skin, and granted
  their doors.
- Editing `npcKey` (committed on enter or blur) removes their npc and adds it back under the new
  key where they stood, keeping their doors; clearing it only removes. Editing `skin` reskins them.

The DEV endpoints load the schema with `ssrLoadModule`, so a schema edit needs no restart; an edit to
the plugin itself does.
