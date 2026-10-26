import "./jsh-cli.d.ts";
import "@npc-cli/ui__world/jsh-cli.d.ts";

export * as util from "./util.js";

export * as act from "./world/act.ts";
export * as core from "./world/core.ts";
export * as debug from "./world/debug.ts";
export * as decor from "./world/decor.ts";
export * as demo from "./world/demo.ts";
export * as pred from "./world/pred.ts";
export * as shots from "./world/shots.ts";
export * as sidestep from "./world/sidestep.ts";
export * as spot from "./world/spot.ts";

import { pausablePtag } from "../shell/pause-group";

const worldPaths = Object.keys(import.meta.glob(["./world/*.ts", "!./world/*.*.ts"], { eager: true }));

/** Set default ptags used by `run` -- see `docs/jsh-pause.md` */
export const modulePtags = Object.fromEntries(
  worldPaths.map((path) => [path.replace(/^.*\/|\.ts$/g, ""), { [pausablePtag("world")]: true }]),
);
