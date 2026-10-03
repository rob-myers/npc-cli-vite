import type { Conversation } from "@npc-cli/ui__world/talk";

const hub = { text: "Something else.", to: "hub" };
const backShip = { text: "Back: ship.", to: "ship" };
const backCrew = { text: "Back: crew.", to: "crew" };
const backPort = { text: "Back: port.", to: "port" };
const backThree = { text: "Back: three things.", to: "trouble-press" };

/**
 * A hand-written stand-in for a generated tree — see `docs/manifest-lore.md`.
 * Every line is one to five words, to be decoded, not read. An emoji is inline, and only where
 * it explains the word before it or stands for a word
 */
export const thawed: Conversation = {
  key: "thawed",
  title: "Thawed",
  summary: "Rob thaws 🧊. Trouble aboard.",
  speaker: "Hale, steward",
  start: "wake",
  nodes: {
    wake: {
      topic: "waking",
      text: "Easy. Thawed. Whole.",
      choices: [
        { text: "Where?", to: "where" },
        { text: "Cold.", to: "cold" },
        { text: "Who?", to: "who", needs: ["facing"] },
      ],
    },
    cold: {
      topic: "waking",
      text: "Always. Drink 🍵.",
      choices: [
        { text: "Drink.", to: "cold-broth", needs: ["near"] },
        { text: "Where?", to: "where" },
      ],
    },
    "cold-broth": {
      topic: "waking",
      text: "Colour's back.",
      choices: [
        { text: "Where?", to: "where" },
        { text: "Who?", to: "who", needs: ["facing"] },
      ],
    },
    who: {
      topic: "waking",
      text: "Hale. Steward.",
      choices: [
        { text: "Did I live?", to: "name-check" },
        { text: "Where?", to: "where" },
      ],
    },
    "name-check": {
      topic: "waking",
      text: "Rob? Low passage. Paid.",
      choices: [
        { text: "That's me.", to: "where" },
        { text: "How long?", to: "how-long" },
      ],
    },
    where: {
      topic: "waking",
      text: "Patient Debt 🚀. Free trader.",
      choices: [
        { text: "How long?", to: "how-long" },
        { text: "The ship?", to: "ship" },
        { text: "Questions.", to: "hub" },
      ],
    },
    "how-long": {
      topic: "waking",
      text: "Eleven days. Officially.",
      choices: [
        { text: "Officially?", to: "how-long-late" },
        { text: "Fine. Questions.", to: "hub" },
      ],
    },
    "how-long-late": {
      topic: "waking",
      text: "Medic busy. I thawed you.",
      choices: [
        { text: "Busy how?", to: "trouble" },
        { text: "Done it before?", to: "crew-steward" },
        { text: "Moving on.", to: "hub" },
      ],
    },

    hub: {
      topic: "topics",
      text: "Ask. Tray can wait.",
      choices: [
        { text: "The ship?", to: "ship" },
        { text: "Who's aboard?", to: "crew" },
        { text: "Where bound?", to: "port" },
        { text: "Something wrong?", to: "trouble" },
        { text: "Any work?", to: "work" },
        { text: "I'll manage. 👋", to: "end-galley" },
      ],
    },

    ship: {
      topic: "ship",
      text: "Old. Paid for.",
      choices: [
        { text: "Cargo?", to: "ship-cargo" },
        { text: "How old?", to: "ship-age" },
        { text: "Jump drive?", to: "ship-jump" },
        { text: "Robots?", to: "ship-robots" },
        { text: "Owner?", to: "ship-owner" },
        hub,
      ],
    },
    "ship-cargo": {
      topic: "ship",
      text: "Parts. Fruit. Pots. Three's sealed.",
      choices: [{ text: "Why sealed?", to: "ship-cargo-hold3" }, backShip],
    },
    "ship-cargo-hold3": {
      topic: "ship",
      text: "Captain's orders. Didn't ask.",
      choices: [
        { text: "Not curious?", to: "trouble-hold" },
        { text: "Fair.", to: "ship" },
      ],
    },
    "ship-age": {
      topic: "ship",
      text: "Older than me. Respect plumbing.",
      choices: [backShip, hub],
    },
    "ship-jump": {
      topic: "ship",
      text: "Jump-one. Never misjumped.",
      choices: [{ text: "Fuel?", to: "ship-jump-fuel" }, { text: "The engineer?", to: "crew-engineer" }, backShip],
    },
    "ship-jump-fuel": {
      topic: "ship",
      text: "Enough. Just.",
      choices: [backShip, hub],
    },
    "ship-robots": {
      topic: "ship",
      text: "One. Tam. Quiet.",
      choices: [{ text: "Sees much?", to: "ship-robots-tam" }, backShip],
    },
    "ship-robots-tam": {
      topic: "ship",
      text: "Everything. People forget it.",
      choices: [{ text: "Would it tell?", to: "trouble-suspect" }, { text: "I'll be polite.", to: "ship" }, hub],
    },
    "ship-owner": {
      topic: "ship",
      text: "Captain. Bank. His sister.",
      choices: [{ text: "The captain?", to: "crew-captain" }, backShip],
    },

    crew: {
      topic: "crew",
      text: "Four. Plus Tam 🤖.",
      choices: [
        { text: "Captain.", to: "crew-captain" },
        { text: "Engineer.", to: "crew-engineer" },
        { text: "Medic.", to: "crew-medic" },
        { text: "You?", to: "crew-steward" },
        hub,
      ],
    },
    "crew-captain": {
      topic: "crew",
      text: "Vance. Fair. Tired. Broke.",
      choices: [{ text: "And today?", to: "crew-captain-missing" }, { text: "Broke how?", to: "ship-owner" }, backCrew],
    },
    "crew-captain-missing": {
      topic: "crew",
      text: "Today? Not there.",
      choices: [
        { text: "Where is he?", to: "trouble-captain" },
        { text: "Overslept?", to: "trouble-deny" },
      ],
    },
    "crew-engineer": {
      topic: "crew",
      text: "Dace. Great hands. Hates everyone.",
      choices: [{ text: "Hates the captain?", to: "crew-engineer-quarrel" }, backCrew],
    },
    "crew-engineer-quarrel": {
      topic: "crew",
      text: "They shouted. Hold three.",
      choices: [{ text: "Saying what?", to: "trouble-hold" }, { text: "Who heard?", to: "ship-robots-tam" }, backCrew],
    },
    "crew-medic": {
      topic: "crew",
      text: "Orrin. Young. Careful. New.",
      choices: [{ text: "Except with me.", to: "crew-medic-berths" }, backCrew],
    },
    "crew-medic-berths": {
      topic: "crew",
      text: "Locked in berth bay.",
      choices: [{ text: "Something's wrong.", to: "trouble-berth" }, backCrew],
    },
    "crew-steward": {
      topic: "crew",
      text: "Twenty years. Trays. Drawers.",
      choices: [{ text: "And before?", to: "crew-steward-past" }, backCrew, hub],
    },
    "crew-steward-past": {
      topic: "crew",
      text: "Other work. Leave it.",
      choices: [
        { text: "Left.", to: "hub" },
        { text: "You'd change the subject.", to: "psi-slip", needs: ["psi"] },
      ],
    },

    port: {
      topic: "port",
      text: "Carrow Down 🪐. Dry. Class C.",
      choices: [
        { text: "Laws?", to: "port-law" },
        { text: "Work there?", to: "port-work" },
        { text: "News?", to: "port-news" },
        hub,
      ],
    },
    "port-law": {
      topic: "port",
      text: "No blades. No slugs.",
      choices: [{ text: "Stunners ⚡?", to: "port-law-stunner" }, backPort],
    },
    "port-law-stunner": {
      topic: "port",
      text: "Fine. Ours stay locked. Usually.",
      choices: [{ text: "Usually?", to: "trouble-press" }, backPort],
    },
    "port-work": {
      topic: "port",
      text: "Loading. Errands. Unwritten ones.",
      choices: [{ text: "Rather work here.", to: "work" }, backPort],
    },
    "port-news": {
      topic: "port",
      text: "Ours. A month stale.",
      choices: [{ text: "And this trip?", to: "port-news-old" }, backPort],
    },
    "port-news-old": {
      topic: "port",
      text: '"Quiet trip." I hope.',
      choices: [{ text: "Not quiet now?", to: "trouble" }, hub],
    },

    trouble: {
      topic: "trouble",
      text: "Why ask?",
      choices: [
        { text: "Thawed late. By you.", to: "trouble-press" },
        { text: "You'll lie next.", to: "psi-slip", needs: ["psi"] },
        { text: "Just a feeling.", to: "trouble-deny" },
      ],
    },
    "trouble-deny": {
      topic: "trouble",
      text: "Then nothing. Rest. Dock.",
      choices: [
        { text: "Suits me. 😴", to: "end-lounge" },
        { text: "It's not nothing.", to: "trouble-press" },
      ],
    },
    "trouble-press": {
      topic: "trouble",
      text: "Three things. 🧊 🔒 🧑‍✈️",
      choices: [
        { text: "The berth 🧊.", to: "trouble-berth" },
        { text: "The hold 🔒.", to: "trouble-hold" },
        { text: "The captain 🧑‍✈️.", to: "trouble-captain" },
        { text: "Who did it?", to: "trouble-suspect" },
        hub,
      ],
    },
    "trouble-berth": {
      topic: "trouble",
      text: "Berth six. Sealed. Amber 🟠.",
      choices: [
        { text: "Who's inside?", to: "trouble-berth-who" },
        { text: "Amber means?", to: "trouble-berth-seal" },
        backThree,
      ],
    },
    "trouble-berth-who": {
      topic: "trouble",
      text: "Sollen. Clerk. Says the manifest.",
      choices: [
        { text: "Manifest lies?", to: "trouble-suspect" },
        { text: "Boarded alone?", to: "trouble-suspect-passenger" },
        backThree,
      ],
    },
    "trouble-berth-seal": {
      topic: "trouble",
      text: "Alive. Kept under. Deliberately.",
      choices: [{ text: "Who can?", to: "trouble-suspect" }, backThree],
    },
    "trouble-hold": {
      topic: "trouble",
      text: "Dace: dump it. Captain: no.",
      choices: [
        { text: "Heard anything?", to: "trouble-hold-noise" },
        { text: "I could open it.", to: "work-door" },
        backThree,
      ],
    },
    "trouble-hold-noise": {
      topic: "trouble",
      text: "Tam did. Captain silenced it.",
      choices: [{ text: "Ask Tam.", to: "ship-robots-tam" }, { text: "Open it.", to: "work-door" }, backThree],
    },
    "trouble-captain": {
      topic: "trouble",
      text: "Cabin locked. Inside. No answer.",
      choices: [
        { text: "Force it.", to: "trouble-captain-cabin" },
        { text: "Last seen by?", to: "trouble-suspect" },
        backThree,
      ],
    },
    "trouble-captain-cabin": {
      topic: "trouble",
      text: "Crew can't. Lost passengers can.",
      choices: [
        { text: "I get lost.", to: "work-door", needs: ["near", "facing"] },
        { text: "I get shot.", to: "work-door-refuse" },
      ],
    },
    "trouble-suspect": {
      topic: "trouble",
      text: "A guess. No proof.",
      choices: [
        { text: "Engineer?", to: "trouble-suspect-engineer" },
        { text: "The passenger?", to: "trouble-suspect-passenger" },
        { text: "You?", to: "trouble-accuse" },
      ],
    },
    "trouble-suspect-engineer": {
      topic: "trouble",
      text: "Dace? Too loud. Not subtle.",
      choices: [
        { text: "Then the passenger.", to: "trouble-suspect-passenger" },
        { text: "I'll watch her.", to: "work-watch" },
        backThree,
      ],
    },
    "trouble-suspect-passenger": {
      topic: "trouble",
      text: "Sollen. Culprit or witness.",
      choices: [
        { text: "Wake them.", to: "work-door" },
        { text: "Who froze them?", to: "crew-medic-berths" },
        backThree,
      ],
    },
    "trouble-accuse": {
      topic: "trouble",
      text: "Me? I thawed you.",
      choices: [
        { text: "True. Sorry.", to: "trouble-press" },
        { text: "Needed a scapegoat?", to: "end-confined" },
        { text: "You'll grab the 🚪.", to: "psi-slip", needs: ["psi"] },
      ],
    },

    work: {
      topic: "work",
      text: "Maybe. Mind questions?",
      choices: [
        { text: "Stand watch.", to: "work-watch" },
        { text: "Open doors.", to: "work-door" },
        { text: "Carry things.", to: "work-carry" },
        { text: "Pay?", to: "work-haggle" },
        hub,
      ],
    },
    "work-watch": {
      topic: "work",
      text: "Drive corridor. Watch Dace.",
      choices: [
        { text: "Pay?", to: "work-watch-pay" },
        { text: "🤝.", to: "end-watch" },
        { text: "Not for me.", to: "work" },
      ],
    },
    "work-watch-pay": {
      topic: "work",
      text: "High berth home. Real food.",
      choices: [
        { text: "🤝.", to: "end-watch" },
        { text: "🪙 too.", to: "work-haggle" },
      ],
    },
    "work-door": {
      topic: "work",
      text: "Two doors. Cabin. Berth six.",
      choices: [
        { text: "Why me?", to: "work-door-why" },
        { text: "🔑.", to: "end-door" },
        { text: "No.", to: "work-door-refuse" },
      ],
    },
    "work-door-why": {
      topic: "work",
      text: "You were frozen. Innocent.",
      choices: [
        { text: "🔑.", to: "end-door" },
        { text: "Thin trust.", to: "end-ally" },
        { text: "No.", to: "work-door-refuse" },
      ],
    },
    "work-door-refuse": {
      topic: "work",
      text: "👍.",
      choices: [
        { text: "Something safer?", to: "work-watch" },
        { text: "I'll sit out.", to: "end-lounge" },
        { text: "Ask later.", to: "hub" },
      ],
    },
    "work-carry": {
      topic: "work",
      text: "A case. To bridge. Unopened.",
      choices: [
        { text: "Won't ask.", to: "end-carry" },
        { text: "What's inside?", to: "work-carry-what" },
      ],
    },
    "work-carry-what": {
      topic: "work",
      text: "Stunners. All four.",
      choices: [
        { text: "I'll carry.", to: "end-carry" },
        { text: "You disarmed everyone?", to: "trouble-accuse" },
      ],
    },
    "work-haggle": {
      topic: "work",
      text: "🪙? Ten minutes awake.",
      choices: [
        { text: "Already useful.", to: "work-watch-pay" },
        { text: "Worth a try.", to: "work" },
      ],
    },

    "psi-slip": {
      topic: "psi",
      text: "I hadn't moved. How?",
      choices: [
        { text: "Lucky guess.", to: "psi-deny" },
        { text: "I hear it coming.", to: "psi-admit" },
      ],
    },
    "psi-deny": {
      topic: "psi",
      text: "Lucky people look calmer.",
      choices: [
        { text: "Drop it.", to: "hub" },
        { text: "Fine. Not luck.", to: "psi-admit" },
      ],
    },
    "psi-admit": {
      topic: "psi",
      text: "🤫! Dace would airlock you.",
      choices: [
        { text: "Useful to you?", to: "psi-admit-use" },
        { text: "You're calm.", to: "psi-wary" },
      ],
    },
    "psi-admit-use": {
      topic: "psi",
      text: "Listen nearby. Tell me after.",
      choices: [
        { text: "🤝.", to: "end-ally" },
        { text: "It's unreliable.", to: "psi-wary" },
      ],
    },
    "psi-wary": {
      topic: "psi",
      text: "Knew one. Ended badly.",
      choices: [
        { text: "Understood.", to: "hub" },
        { text: "Lounge, then.", to: "end-lounge" },
      ],
    },

    "end-watch": { topic: "ending", text: "Port corridor. Look ill." },
    "end-door": { topic: "ending", text: "🔑. Cabin first. Say nothing." },
    "end-lounge": { topic: "ending", text: "Lounge. You slept through it." },
    "end-galley": { topic: "ending", text: "Galley's forward. Mind Tam 🤖." },
    "end-confined": { topic: "ending", text: "Enough. Lounge. Door shut." },
    "end-ally": { topic: "ending", text: "🤝. Walk with me." },
    "end-carry": { topic: "ending", text: 'Bridge locker. "My laundry 💼."' },
  },
};
