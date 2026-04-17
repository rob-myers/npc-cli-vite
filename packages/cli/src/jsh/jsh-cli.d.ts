declare namespace JshCli {
  type ProcessApi = import("../shell/command").ProcessApi;
  type ProcessContext = import("../shell/command").ProcessContext;

  type WorldState = import("@npc-cli/ui__world").WorldState;

  export interface RunArg<Datum = any> {
    api: ProcessApi & {
      getCached(key: "__WORLD_KEY_VALUE__"): WorldState;
    };
    args: string[];
    w: WorldState;

    etc: ProcessContext["etc"];
    home: ProcessContext["home"] & {
      WORLD_KEY: "__WORLD_KEY_VALUE__";
    };
    lib: ProcessContext["lib"];

    datum: Datum;
  }

  type Event =
    | { key: "disabled" }
    | { key: "enabled" }
    | { key: "nav-updated" }
    | {
        key: "picked";
        // 🚧 refine...
        meta: {
          type: string;
          instanceId: number;
          gmKey?: string;
          collapse?: boolean;
        };
      };
  // 🚧 ...
}
