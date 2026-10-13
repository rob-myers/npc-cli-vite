# Psi

The ONLY doc for the player's psi. The bar slot and the `q` key are in `docs/inventory.md`.

## What it is now

Psi is RAISED or not, per npc, and `w.e.setPsi(active, ...npcKeys)` is the one way it changes. Nothing is
kept and nothing ticks: raised IS their left arm showing `psi`, which `w.e.isPsiRaised()` reads, the player's by default.

- **Raised, their left hand goes to their temple** (the `psi` upper clip), elbow tucked
  in front of them, so it clears a neighbour, a doorway and a bunk alike.
- **Raised, their breath shows too**: their lungs and diaphragm, as `docs/npc-breath.md` has them. The
  bubble's **breath** button still switches it by hand.
- **The player's goes with the player**: a switch lowers the last one's, and raises the new one's if
  they are granted it (`w.player.assign`).
- **The player's is switched** by `q`, its bar slot, a press on their own left arm (jsh `inventory`), or jsh
  `psi` / `psi off`. Turning it on from the bar or `q` needs psi granted (`w.e.hasItem`).
- **Anyone else's** by jsh `psi npc-0` / `psi off npc-0`, granted or not.
- **It has no target.** Nothing is drawn between the player and anyone else.
- **Raised, a press on another npc reads their thought** (`w.speech.readThought`, from jsh `inventory`), at once.
- **A talk's reply can wait on it**: the `psi` need of `talkNeeds` is met whilst psi is raised.

## Thoughts

A THOUGHT is something an npc thinks and does not say, marked with the khandha it belongs to
(`service/thoughts.ts`, colours in `psiKhandhas`). `w.speech.readThought` shows one two ways, through `w.speech.think`:

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
