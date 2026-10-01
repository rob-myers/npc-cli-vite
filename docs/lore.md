# Lore

Backstories and speech for the setting (see `docs/chats/DESIGN-storyline-and-ai.md`), authored in
DEV and shipped as data. No model runs: variety comes from Tracery-style grammars.

## Data

One JSON file per entry, `packages/media/lore/{kind}/{slug}.json`, its key `{kind}/{slug}`. Kinds:
`setting`, `level`, `place`, `faction`, `character`. `LoreEntrySchema`
(`ui/decorator/src/lore/lore.schema.ts`) has `title`, `summary`, `backstory`, `voice`, `facts`,
`links`, `grammar`, `dialogue` (unused as yet), and what it has in the World (below).

`scripts/src/vite-plugin-lore.ts` provides them, as `jobsExamplesPlugin` does its examples:

| | DEV | production |
|---|---|---|
| read | `GET /api/lore`, every entry by key | `virtual:lore`, bundled |
| write | `POST` / `DELETE /api/lore/file/{kind}/{slug}`, zod-checked | read-only |
| change | the watcher sends `lore-changed`; the pane reloads | |

A key must be a known kind and a `[a-z0-9-]` slug, which is what keeps a write inside the folder.

## Grammars: `lore/tracery.ts`

`#rule#` expands to one of the rule's options; `#rule.capitalize#`, `.capitalizeAll`, `.a` and `.s`
modify it; `[name:#rule#]` fixes a choice as `name` for the rest of the line; `\#` is a literal. A
missing rule reads `((rule))`. `seededRng` makes a line reproducible.

An entry's grammar is merged from, later winning rule by rule:

1. every `setting` entry's grammar;
2. each linked entry's (`links`);
3. the entry's `facts`, each a rule of one option (`#role#`);
4. the entry's own `grammar`;
5. the World's facts: `npc`, `room` (their `grKey`) and `player`.

## The pane: `lore/LorePane.tsx`

The Decorator's second pane (`docs/decorator.md`), lazy, and mounted only once shown. Entries by
kind; a card to edit (DEV only; an edit saves itself `autosaveMs` after the last keystroke); and a preview sampling one rule, each line
sayable by an npc via `w.speech.say`. The grammar is JSON, compact (a short rule on one line) and
coloured by `GrammarEditor`: a layer beneath a textarea of transparent text, `#tags#` and
`[actions:` picked out. Who says it: the one chosen there, else the entry's
`facts.npcKey`, else the last npc chosen on the map, else the psi target, else the player.

Selecting an entry centres the map on its npc, else its first room; choosing an npc on the map
shows the entry whose `npcKey` they are. Without a World the pane still edits.

## In the World

An entry has `maps[mapKey].rooms` (grKeys); a character also `npcKey`, `skin` and
`maps[mapKey].doors` (the gdKeys they hold keys to). Per map, as a `g0r21` means nothing on another.

- The map pane outlines the shown entry's rooms and doors (`lore/LoreLayer.tsx`).
- Its **spawn {npcKey}** button puts them where the map is next clicked (`Editor.spawnAt`): spawned
  or moved, in their skin, and granted their doors.
- Editing `npcKey` (committed on enter or blur) removes their npc and adds it back under the new
  key where they stood, keeping their doors; clearing it only removes. Editing `skin` reskins them.

The DEV endpoints load the schema with `ssrLoadModule`, so a schema edit needs no restart; an edit to
the plugin itself does.
