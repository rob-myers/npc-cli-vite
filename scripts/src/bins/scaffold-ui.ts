#!/usr/bin/env node

import { existsSync, globSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path/posix";
import { input } from "@inquirer/prompts";
import { PROJECT_ROOT } from "../const.ts";
import { sh } from "../sh.ts";

const TEMPLATE_COMPONENT_DIR = join(PROJECT_ROOT, "packages/ui/template");

const { packageName, packageDirectory } = await (async (): Promise<{
  packageName: string;
  packageDirectory: string;
}> => {
  const packageSuffix = await input({
    message: 'package suffix e.g. "foo" will become @npc-cli/ui__foo',
    validate: (value) =>
      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) ||
      `invalid package suffix ${value}: must be non-empty lowercase and dash-separated`,
  });

  const packageName = `@npc-cli/ui__${packageSuffix}`;

  const defaultPackageDirectory = `packages/ui/${packageSuffix}`;

  return {
    packageName,
    packageDirectory: defaultPackageDirectory,
  };
})();

if (existsSync(packageDirectory)) {
  console.error(`Package directory already exists: ${packageDirectory}`);
  process.exit(1);
}

const files = (() =>
  Object.fromEntries(
    globSync("**/*", {
      cwd: TEMPLATE_COMPONENT_DIR,
      exclude: ["**/node_modules"],
      withFileTypes: true,
    })
      .filter((dirent) => dirent.isFile())
      .map((dirent) => join(dirent.parentPath, dirent.name))
      .map((p) => [
        relative(TEMPLATE_COMPONENT_DIR, p),
        readFileSync(p, "utf8").replaceAll("@npc-cli/ui__template", packageName),
      ]),
  ))();

console.log("Scaffolding files...");

await mkdir(packageDirectory, { recursive: true });

await Promise.all([
  ...Object.entries(files).map(async ([fileName, content]) => {
    const filePath = join(packageDirectory, fileName);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      typeof content === "string" ? content : JSON.stringify(content),
      "utf8",
    );
  }),
]);

// checkTsconfigReferences({ fix: true });

console.log("✅ Scaffolding done!");

sh("pnpm install");
// sh('pnpm check:fix');
// sh('pnpm check:fix tsconfig.json');
