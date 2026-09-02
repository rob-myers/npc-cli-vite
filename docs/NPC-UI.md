# Npc UI via bubbles — what was built, before reverting

Written up because it is being reverted in favour of the `say` api. Everything below is independent:
take any piece on its own.

## Context

A long press on an npc toggled whether they were lit, gated by the debug setting `litNpcsEditable`
(long-pressing the fade-mode button turned it on, shown as a pencil badge on its corner). One gesture
wired to one action, with nowhere to put a second.

The attempt: make the long press open that npc's `NpcBubbles` bubble, and make the bubble's ellipsis
a menu of what can be done to them — lighting becoming one item among several.

It works, but every npc you want to do something to leaves a box floating over the map, and the boxes
crowd each other. Hence the `say` direction instead.

---

## The pieces

### 1. Two genuine bug fixes, worth keeping whatever happens

**Panning was vertical-only.** `SpeechBubbleApi.onDragMove` unprojects both the drag's start and
current client points at the anchor's NDC depth — so their difference is already a world-space vector
lying in the camera plane, i.e. a straight screen-space pan. It then threw two thirds of it away:

```ts
this.offset.y = this.drag.worldOffsetAtStart.y + tmpVec2.y - tmpVec.y;
```

Writing `x` and `z` as well is the whole fix; no new maths, the vector was already correct.

**A bubble does not re-render when the npc changes.** `MemoizedSpeechBubble` is
`memo(NpcBubble)` over `{ bubble, epochMs }`, and `bubble` is a stable object — so **only `epochMs`
moving re-renders it**, which is what `forceRender()` does. `w.e.setNpcLit` writes a uniform and
syncs the fade service; nothing bumps `epochMs`. So any bubble UI reflecting npc state must call
`b.forceRender()` itself. This cost me a "the lead tag isn't showing" round trip.

### 2. `litNpcsEditable` → `npcsUiEnabled`

The setting that the fade-mode button's long press toggles. Renamed because it no longer gates
*editing lit-ness*, it gates *whether a long press on an npc opens any UI at all*.

- `service/storage.ts` — the field and its default (`false`), jsdoc reworded.
- `WorldView.tsx` — the field and `setLitNpcsEditable` → `setNpcsUiEnabled`. Plain boolean, not a
  uniform: no shader reads it.
- `WorldMenu.tsx` — the corner badge went `PencilSimpleIcon` → `ChatCircleTextIcon`.

**`litNpcsEnabled` was deliberately left alone** — the "Lit npcs" debug row, the shader gate in
`NPCs.tsx` and the room island in `service/fade-rooms` are a separate concern ("does being lit
*show*") from who gets lit. Keep that split whatever replaces the bubble.

### 3. The long press opens the bubble

`use-world-events.ts`, the `"picked"` case, in place of `setNpcLit`:

```ts
if (w.view.npcsUiEnabled === true && e.longDown === true && e.meta.type === "npc") {
  const bubble = w.bubble.get(npcKey);
  bubble === null ? w.bubble.ensure(npcKey) : bubble.fadeAndDelete();
}
```

Toggling, so the same gesture puts it away. Both halves already existed — `w.bubble.ensure` and
`fadeAndDelete` — and `demo_npc_ui npc:rob` was the only other caller of `ensure`.

### 4. A base-ui `Menu` on the ellipsis

A `Menu` rather than a `Select`: these are actions to run, not a value to hold. Local to
`NpcBubbles.tsx`, following the `Root`/`Trigger`/`Portal`/`Positioner`/`Popup` shape in
`WorldMenu.tsx`.

**`Menu.Portal container={b.w.rootEl}` works fine from inside `Html3d`.** The popup anchors to the
trigger's real screen rect and so lands correctly, and portalling out means it does *not* inherit the
`Html3d` CSS transform — so it stays at UI scale rather than scaling with the bubble, which is what
you want for a menu.

Items were **make a lead / make an extra** (`w.e.setNpcLit`, hidden for the player since `setNpcLit`
refuses them and the item would silently do nothing) and **emote**.

### 5. Emote

`SpeechBubbleApi` grew two plain fields — plain data, since that file's HMR strategy does not carry
function-valued *properties* across a reload:

```ts
emote: null | string = null;
picking: null | "emote" = null;
```

with `setEmote` / `setPicking`, both calling `forceRender()`. Choices were a module-level
`const emotes = ["😀", "😐", "😠", …]` — plain unicode, no assets, no dependency.

Whilst picking, the picker took over the **whole** bubble (`absolute inset-0`) as one
`overflow-x-auto` row. Two rounds of "too small" got the buttons to `size-28 text-7xl`; the lesson is
that the bubble renders small on screen, so anything sized for a normal UI reads as tiny in it.

**The bubble had to grow.** Default height is `6rem` and it clips its overflow, so showing an emote
big needs a taller default:

```tsx
tall === true ? "h-(--bubble-height,13rem)" : "h-(--bubble-height,6rem)"
```

That only moves the *fallback*: a bubble the user has resized has `--bubble-height` set and keeps its
own size. Neat trick, worth reusing.

`NpcBubbles.prevData` — which already carried `offset` and `cssVars` across a delete/re-ensure —
carried `emote` too. It was never persisted to `PersistedNpc`.

### 6. Restyle

`border-4 border-white/40` on `bg-black/70` → `rounded-xl bg-slate-900/25` with `ring-2` and a drop
shadow; header as a proper row with the name flush left (`text-3xl font-semibold tracking-tight`,
truncating) and ghost icon buttons flush right; a **lead** tag plus an emerald ring when
`npc.lit`, so the state reads without opening the menu.

**`backdrop-blur-md` is not transparency.** It was there for legibility over busy geometry and it
made the bubble read as frosted rather than see-through. Dropped; `bg-slate-900/25` with a slightly
stronger ring (`white/15`) holds the edge on its own.

### 7. Always interactive — the piece I would not repeat as-is

The bubble had an `interact` mode: the menu's "resize" item turned it on, it expired after 5s, and
only whilst on did the bubble take pointer events, show its resize grip and drag. Asked to make
resize and pan *always* available, I removed the mode outright — `interact`, `toggleInteractive`,
`deactivateInteractive` and the four timer methods, plus the `NpcBubbles` event subscription that
existed only to pause and resume that timer whilst the world was disabled.

**That mode was load-bearing.** An always-`pointer-events-auto` bubble intercepts every click over
its own rectangle, so the world behind it is no longer clickable. The 5s timer was the price paid for
that, not an oversight. If you want always-on editing, the shape to use is: **only the header row and
the resize grip take pointer events, and the body stays transparent to them** — you lose
drag-anywhere but keep the world clickable.

---

## Tried and rejected

- **`Select` for the ellipsis** — three actions to run, not a value to hold. `Menu` is right.
- **Wrapping emote grid** inside the bubble — overflows a 6rem box, which clips. One scrolling row.
- **Emote at full colour** — an emoji is the brightest thing on screen against a slate palette;
  `opacity-60 saturate-50` settled it. Reconsider if emotes move somewhere with its own surface.

## Gotcha worth remembering

A JSX comment cannot be the first token of a ternary branch or `&&` body:

```tsx
{cond ? (
  {/* boom: TS1005 */}
  <div/>
) : null}
```

It has to be a sibling of the whole expression, or inside the element. Cost me two compile rounds.

---

## Notes towards the `say` direction

`w.speech.say(npcKey, words, secs)` — `WorldSpeech.tsx` — already does most of what the bubble was
being asked to do, without a box per npc:

- a toast list with a per-entry `secs` that **only drains whilst the world is unpaused**, since
  `onTick` runs off the world clock;
- a bounded `history`, and a `speech` event on `w.events` for anything else to hang off;
- driven from the shell as `say hi npc:rob for:10` (`packages/cli/src/jsh/world/core.ts`), so
  `for:Infinity` already covers "leave it up".

So an emote is plausibly just `say` with an emoji in it, and "make a lead" wants to be a command or a
long-press action rather than a menu item — leaving nothing floating over the map. The two bug fixes
in §1 and the `npcsUiEnabled` rename in §2 are worth keeping either way.
