# Design notes: storyline and game AI tooling

Handoff from a claude.ai design conversation. "Decided" means the author chose it;
"Proposed" means suggested and not yet confirmed.

## Storyline

### Decided
- Inspired by William Hope Hodgson's *The Night Land* ("The Last Redoubt"), but not following its plot.
- The Last Redoubt is a stack of defunct spaceships joined together: geomorphs (Robert Pearce's Starship Geomorphs) on many levels.
- The Redoubt is long corrupted; only certain levels still support humans, and this has been so for a very long time.
- The player's level (city) lacks a vital resource (cf. Fallout 1's water chip). The player explores the forbidden zone: the lost levels.
- No second redoubt as a place to visit, and the player never leaves the Redoubt.
- Structure: either one long expedition or repeated expeditions returning home; both are under consideration.

### Existing systems and their story use
- **Psychic link:** any NPC can be linked to the player, but only one at a time. Expected to be used in many ways, including a voice from the lost levels calling the player (guide or lure).
- **Weapon beam** locking onto body parts (head, hips, left shin): currently fired from one NPC at another. Could also be fired by still-active defence systems in the defunct ships.
- **Skins:** NPCs are edited Minecraft skins on a Blockbench model, mostly animated by Claude. Skins currently change wholesale; a UV/part-based system could allow per-part changes.

### Proposed
- Resource options: power (level's coupling to the Redoubt's current), food (hydroponics blight), or air/water purifier core.
- A visible clock: the hub level degrades noticeably (Decorator), so time has a cost.
- Each lost level was a ship with its own crew and way of dying, told through layout and decor.
- Corruption changes people; shown via skins. Skins as unreliable identity: someone who looks right but isn't.
- Beat outline: failure noticed in hub → descents, each giving a partial answer → revelation at home (shortage not natural?) → deepest descent and a choice about the cost.

## Game AI

### Decided
- The Jsh shell is a development/foundation tool (building, YouTube streaming, letting non-developers experiment), not part of gameplay.
- Processes (pause/resume/kill, exit codes; non-zero is failure) are the foundation for other game AI tools.
- Not wanted: statecharts/FSMs, utility AI, GOAP/HTN planners, scenarios/MSCs, blackboards, conventional behaviour trees, opinionated frameworks. Wanted: tools that help build systems over time.
- No UI for a knowledge base: predicates and queries live in JS and the shell.

### Recorder and composer (decided direction)
- Record only externally visible actions (move, turn, animate, open door, fire, link, say), not process internals.
- Each action optionally records **why** (a reason): a pointer to an earlier entry, the issuing process/command, or a note.
- Replay by **intent** (re-navigate to targets), not exact reproduction (except perhaps in isolation).
- Recordings are abstracted into **nodes**. Nodes combine by:
  - **sequence** (A then B),
  - **parallel** (A alongside B; lanes can wait on events emitted by others),
  - **choice** (alternatives).
- Roles (NPCs), rooms and doors are parameters with defaults (the recorded values).
- Missing dependencies are auto-filled (e.g. insert a move so a role is where the next node expects).
- Stuck handling when NPCs block each other: strategies such as wait, yield/step aside, back off, reroute, squeeze past, fail.
- A good node-based UI with automatic graph layout.

### Proposed details
- Node interface: roles, where each role starts/ends, emitted events, steps (intents), reasons, exit code.
- Derived parameters (e.g. "door between rooms A and B") so rebinding a room updates doors.
- Composition unifies same-named parameters unless renamed.
- Auto-filled nodes shown dashed with their reason; can be pinned to become real nodes.
- Choice: committed choice via guards (default guard: requirements satisfiable now), optional fall-over to the next branch from the current world state. A choice guarantees only what *all* branches provide. Variants: ordered, weighted/random, race (only for disjoint NPCs or waits).
- Stuck strategies and fillers become ordinary choice nodes.
- Door/corridor reservation to prevent deadlocks.
- Flight recorder + in-world overlays + NPC inspector; sandbox rooms; replay/regression; generated function catalogue; spatial annotations; live tuning.

### Prolog reading (proposed)
- A node is a **term** Prolog reasons about, not a goal it executes (world side effects can't be backtracked). JS runs nodes.
- Interface as facts: `node/1`, `default/2`, `requires/2`, `provides/2`, `emits/2`; `seq/2`, `par/2`, `alt/2` as term constructors.
- Auto-fill = query for unmet requirements and fillers; the proof is the explanation.
- Recording → node is generalisation (anti-unification; Plotkin's least general generalisation); defaults are the recovering substitution.
- Parallel + events ↔ concurrent logic programming (Parlog, GHC): emitting binds a shared variable; waiting suspends on it.
- Duplicating a node = new instance of the definition with fresh variables (renamed apart). Fork = new diverging definition. Event variables renamed apart per instance unless deliberately shared (= race). Warn when duplicated defaults put one NPC in two parallel lanes.
- Layout: compositions are series-parallel → nested-box layout; event waits drawn as routed edges on top. Candidates: React Flow (`@xyflow/react`), elkjs (compound nodes, ports, orthogonal routing).
- Engines if needed: Tau Prolog (JS), `swipl-wasm`; or a small hand-written Datalog for derived world facts.

### References
- Guerrilla, "HTN Planning in Decima" (Prolog-like backtracking over preconditions; flow visualisation).
- Ian Horswill, MKULTRA (Prolog in Unity; mind control by injecting beliefs); postmortem AIIDE 2018.
- Zubek, Horswill et al., "Social Modeling via Logic Programming in City of Gangsters", AIIDE 2021.
- Eric Zinda, Exospecies / Inductor HTN (Prolog engine for HTN state).
- Smith, Nelson, Mateas, "Ludocore: A logical game engine" (event calculus), CIG 2010.
- Evans & Short, Versu/Praxis; Chris Martens, Ceptre.

## Open questions
- Which missing resource?
- One long expedition vs repeated returns home (or a hybrid)?
- Should node roles carry constraints (e.g. "must be a guard")?
- Is the graph mainly for viewing/arranging, or the primary editor (with the shell for recording)?
- Next step proposed: TypeScript types for nodes and the `seq` / `par` / `alt` constructors, shared by the runner and the Prolog-style queries.
