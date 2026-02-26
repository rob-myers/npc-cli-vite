#!/usr/bin/env node --import=tsx

import { info } from "@npc-cli/util/legacy/generic";
//@ts-expect-error
import getopts from "getopts";

const opts = getopts(process.argv, { string: ["changedFiles"] });

info("genSymbolThumbs", opts.changedFiles);
