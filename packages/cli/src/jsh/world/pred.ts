import { sharedFolder } from "../../shell/session";

export function pred(ct: JshCli.RunArg) {
  ct.w.e.addKeyedListener("pred", (e: JshCli.Event) => sharedFolder.pred?.event?.(e));
}

// 🚧 WIP
function onWorldEvent(event: JshCli.Event) {
  if (event.key === "disabled") {
    console.log("pred: detected disabled");
  }
}

(sharedFolder.pred ??= {}).event = onWorldEvent;
