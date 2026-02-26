#!/usr/bin/env node --import=tsx

import { ansi } from "@npc-cli/cli/shell/const";

console.log(`${ansi.Blue}Watching symbols...${ansi.Reset}`);

while (true) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  throw new Error("Simulated crash");
}
