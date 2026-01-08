import { spawnSync } from "node:child_process";
import { PROJECT_ROOT } from "./const.ts";

/**
 * runs the given shell command from the project root
 */
export const sh = (command: string): void => {
  const [arg0, ...argv] = command.split(/\s+/);
  const result = spawnSync(arg0, argv, { cwd: PROJECT_ROOT, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command}`);
  }
};
