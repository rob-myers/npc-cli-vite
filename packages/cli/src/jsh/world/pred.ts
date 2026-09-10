// 🚧 WIP
function onWorldEvent(event: JshCli.Event) {
  if (event.key === "disabled") {
    console.log("pred: detected disabled");
  }
}

export const SHELL_ACTS: JshCli.SHELL_ACTS = {
  extend_shared(shared: JshCli.ProcessContext["shared"]) {
    (shared.pred ??= {}).event = onWorldEvent;
  },
};
