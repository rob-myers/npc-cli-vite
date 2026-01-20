import type { UiInstantiatorDef } from "@npc-cli/ui-sdk";

export * from "./index";

export { Jsh as default } from "./index";

export const InstantiatorDef: UiInstantiatorDef = {
  inputs: {
    sessionKey: { type: "text" },
  },
};
