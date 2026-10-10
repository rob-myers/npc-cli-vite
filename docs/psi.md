# Psionic powers

The player's psi: what it is for, how thoughts are read, what is drawn, and what is still only
planned. The bar slot, the `q` key and the hand at the temple are in `docs/inventory.md`.

## The idea

A target's mind is modelled on the five khandhas (aggregates). They belong to the TARGET, and each
depends on the one before:

```
form -> sensation -> perception -> formations -> consciousness
                                    ^      |
                                    `------'  (formations feed themselves)
```

| Khandha | What it is | In the world |
|---|---|---|
| form | the body | what they carry, where they are hurt, their pose |
| sensation | form striking the psyche | pleasant, painful or neutral: in pain after a hit, at ease when sat |
| perception | sensation made into units | whom and what they have noticed, the rooms and doors they know |
| formations | units combined: histories, plans | where they mean to go, the replies they hold back |
| consciousness | awareness of all of it | what they attend to, outside and in |

## Status

- BUILT, UNSEEN: the exchange below. Written without being run.
- PLACEHOLDER: what is thought. Everyone thinks the same `demoThoughts`, in turn.
- PLANNED: thoughts of a character's own, and from what is happening to them.
- PLANNED: an intention which says something, and a thought which answers it.
- PLANNED: a thought on a line of a conversation, and replies which wait on one being read.

## The exchange

Nothing is sent of itself. Each time the player CHOOSES someone with psi, a press on them whilst it
is on, the same one again or another, `Psi.exchange` runs once:

1. **The player's INTENTION** goes out from them towards the target, at `PsiTune.speed` by `speedOver`
   metres a second.
2. **The target's THOUGHT** goes out from them in answer, as it gets there, in its khandha's colour.
3. **It is read** as it reaches the player: over the target's head, and in the history.

So no thought comes without an intention sent, and none is read before it has come. One asked for
whilst another is under way waits for it to be answered. Psi coming off, or going to another, drops
what was on its way. Raised again (`q`) psi is back on whom it was on, but sends nothing until they
are pressed.

## Thoughts

A THOUGHT is something an npc thinks and does not say, marked with the khandha it belongs to
(`service/thoughts.ts`).

- **Over their head.** `w.bubble.think` shows it above anything they are saying, outlined in its
  khandha's colour and naming it, for `shownSecs`. One thought per npc, the latest.
- **In the history.** `w.speech.think` puts it in their thread with the player in `WorldSpeech`,
  outlined likewise. It raises no `speech` event, so a net client never hears of it.

The colours are `psiKhandhas` in `const.npc`.

## How it is drawn

`components/Psi.tsx` owns the state and `service/psi-shader.ts` the look. The two waves are the same
thing drawn twice (`waveNodes`), each a uniform of metres its front has come (`intent`, `thought`),
less than nought for none.

- **A wave** is ONE line, at its front, `PsiTune.width` pixels wide. It grows out of nothing over
  `startOver`, and is gone by the time it reaches whom it makes for (`landFrom`).
- **Where:** on a square about whoever sends it, level with their crown, and only within
  `coneHalfDeg` either side of the way to whom it makes for.
- **The intention** is in the player's colour (`PsiTune.color`). **The thought** is in its khandha's.
- The shader is told only where the two of them are (`playerAt`, `otherAt`).
- Over a pale deck a line is laid over it in a deeper ink with a dark casing, not added as light.
- An npc's border is not drawn over a wave. A wave marks itself a caption in `npcMask.g`, as a
  label does (`syncOutlineMask`, see `service/npc-outline`).
