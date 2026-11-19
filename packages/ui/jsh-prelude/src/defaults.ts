/// <reference path="./virtual.d.ts" />
import fences from "virtual:skip-net-autorun";
import { fenceIdOf, splitExamples } from "@npc-cli/cli";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import type { PreludeEntry } from "./store";

const device = isTouchDevice() ? "mobile" : "desktop";

/** The commands autorunning on this device until turned off, as marked in their articles e.g. `# @bootable mobile` */
export const defaultEntries: PreludeEntry[] = fences.flatMap(({ articleKey, src }) =>
  splitExamples(fenceIdOf(articleKey, src), src.split("\n")).flatMap((example) =>
    example.autorunOn.includes(device)
      ? { id: example.id, articleKey, src: example.src, comment: example.commentLines.join("\n") }
      : [],
  ),
);

export const defaultIds = new Set(defaultEntries.map((x) => x.id));
