declare namespace NPC {
  type ProcessApi = import("../shell/command").ProcessApi;
  type ProcessContext = import("../shell/command").ProcessContext;

  export interface RunArg<Datum = any> {
    api: ProcessApi & {
      // getCached(key: '__WORLD_KEY_VALUE__'): WorldState;
    };
    args: string[];
    // w: WorldState;
    // tabs: TabsState['api'];

    etc: ProcessContext["etc"];
    home: ProcessContext["home"] & {
      // FEEDBACK_KEY?: `feedback-${number}`;
    };
    lib: ProcessContext["lib"];

    datum: Datum;
  }
}
