/** A scenario of `docs/scenarios.md`: as yet a stub, its steps only described */
export type ScenarioStub = {
  key: string;
  title: string;
  npcs: string;
  status: "not started";
  steps: { title: string; text: string }[];
};

export const scenarios: ScenarioStub[] = [
  {
    key: "hide-and-seek",
    title: "Hide and seek",
    npcs: "a seeker, 2-3 hiders",
    status: "not started",
    steps: [
      {
        title: "Scatter",
        text: "Each hider takes a spot the seeker's spot does not see, preferring cover or a doable.",
      },
      { title: "Search", text: "The seeker walks to the spot that sees the most spots it has not yet seen." },
      { title: "React", text: "A hider about to be seen crouches behind cover, else sneaks to a spot neither sees." },
      { title: "Found", text: "Once the seeker sees a hider, it says so, and that hider searches too." },
    ],
  },
  {
    key: "guard-and-intruder",
    title: "Guard and intruder",
    npcs: "2 guards, an intruder",
    status: "not started",
    steps: [
      { title: "Post", text: "The guards take two spots which between them see every door of a room." },
      { title: "Slip through", text: "The intruder goes door to door through spots neither guard sees." },
      { title: "Alert", text: "A guard who sees the intruder tells the other, who cuts off the way out." },
      { title: "Standoff", text: "The guards raise their phasers. The intruder hides behind cover, or gives up." },
    ],
  },
  {
    key: "meeting-in-secret",
    title: "Meeting in secret",
    npcs: "2 conspirators, a watcher",
    status: "not started",
    steps: [
      { title: "Choose a place", text: "Two spots in sight of each other that the watcher's spot does not see." },
      { title: "Arrive apart", text: "Each takes a route the watcher does not see, at a different time." },
      { title: "Lookout", text: "Whilst one talks, the other watches the door the watcher would come through." },
      { title: "Scatter", text: "Warned, they leave by different doors to spots hidden from the watcher." },
    ],
  },
  {
    key: "breach-and-clear",
    title: "Breach and clear",
    npcs: "a squad of 3, those inside",
    status: "not started",
    steps: [
      { title: "Stack up", text: "One door spot each on the near side of the door, hidden from the inside." },
      { title: "Entry", text: "The first two take the corner spots that see most of the room." },
      { title: "Clear", text: "Spots no one sees yet are each sent the nearest free member." },
      { title: "Hold", text: "Once every spot is seen, one watches the door and the rest gather." },
    ],
  },
];
