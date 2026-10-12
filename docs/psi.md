# Psi

The ONLY doc for the player's psi. The bar slot and the `q` key are in `docs/inventory.md`.

## What it is now

Psi is ON or OFF, and that is all `components/Psi.tsx` (`w.psi`) holds.

- **On, the player's left hand goes to their temple** (`syncHands`, the `psi` upper clip). Near a
  crowd neighbour, in a doorway, or lain on that arm, it is `psi_avoid`, elbow tucked.
- **On, their breath shows too**: their lungs and diaphragm, as `docs/npc-breath.md` has them. It goes
  with psi to whoever is made the player. The bubble's **breath** button still switches it by hand.
- **It is switched** by `q`, its bar slot, a press on the player's own left arm (jsh `inventory`), or jsh
  `psi` / `psi off`. Turning it on from the bar or `q` needs psi granted (`w.e.hasItem`).
- **It has no target.** Nothing is drawn between the player and anyone else.
- **Raised, a press on another npc reads their thought** (`w.psi.read`, from jsh `inventory`), at once.
- **A talk's reply can wait on it**: the `psi` need of `talkNeeds` is met whilst psi is raised.

## Thoughts

A THOUGHT is something an npc thinks and does not say, marked with the khandha it belongs to
(`service/thoughts.ts`, colours in `psiKhandhas`). `w.psi.read` shows one two ways, through `w.speech.think`:

- **Over their head.** `w.bubble.think` shows it above anything they are saying, outlined in its
  khandha's colour and naming it, for `shownSecs`. One thought per npc, the latest.
- **In the history.** `w.speech.think` puts it in their thread with the player in `WorldSpeech`,
  outlined likewise. It raises no `speech` event, so a net client never hears of it.

What is thought is a PLACEHOLDER: everyone thinks the same `demoThoughts`, in turn.

The khandhas a mind is modelled on, each depending on the one before:

| Khandha | What it is | In the world |
|---|---|---|
| form | the body | what they carry, where they are hurt, their pose |
| sensation | form striking the psyche | pleasant, painful or neutral: in pain after a hit, at ease when sat |
| perception | sensation made into units | whom and what they have noticed, the rooms and doors they know |
| formations | units combined: histories, plans | where they mean to go, the replies they hold back |
| consciousness | awareness of all of it | what they attend to, outside and in |

## Dropped

- **Targeting.** Psi was on someone: the npc last pressed, whose room was then shown, and jsh
  `psi npcKey`. A press now reads a thought and is forgotten.
- **The exchange and its waves.** Each choice sent the player's INTENTION to the target as a line
  and a sinusoid, and their THOUGHT came back the same way, read only once it arrived
  (`service/psi-shader`, `service/psi-influence`).
- **`PsiControls`**, the bubble's sliders for those waves, and `psiTune` in the World's settings.
