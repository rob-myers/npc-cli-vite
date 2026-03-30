import childProcess from "node:child_process";
import { ansi } from "@npc-cli/cli/shell/const";

/**
 * Logs std{out,err} with `label` prefix.
 * Options can be provided as single args like `--quality=75`.
 */
export async function loggedSpawn({
  label,
  command,
  args,
  shell = false,
}: {
  label: string;
  command: string;
  args: string[];
  shell?: boolean;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = childProcess.spawn(command, args, {
      shell,
    });
    proc.stdout.on("data", (data) =>
      (data.toString() as string)
        .trimEnd()
        .split("\n")
        .forEach((line) => console.log(`[${ansi.Bold}${label}${ansi.Reset}]`, `${line}${ansi.Reset}`)),
    );
    // stderr needn't contain error messages
    proc.stderr.on("data", (data) =>
      (data.toString() as string)
        .trimEnd()
        .split("\n")
        .forEach((line) => console.log(`[${ansi.Bold}${label}${ansi.Reset}]`, `${line}${ansi.Reset}`)),
    );
    // proc.stdout.on('close', () => resolve());
    proc.on("error", (e) => reject(e));
    proc.on("exit", (errorCode) => {
      if (typeof errorCode === "number" && errorCode !== 0) {
        reject({ errorCode });
      } else {
        resolve();
      }
    });
  });
}
