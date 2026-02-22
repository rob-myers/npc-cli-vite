import childProcess from "node:child_process";
import fs from "node:fs";
import { ansi } from "@npc-cli/cli/shell/const";
// relative imports for sucrase-node
import { assertDefined } from "@npc-cli/util/legacy/generic";

function extractGeomorphInfo(info: string): FilenameMeta {
  const is: string[] = [];
  const has: string[] = [];
  const parts = info.split(" ");

  if (parts[0] === "[Overlay]") {
    is.push(assertDefined(parts.shift()).slice(1, -1).toLowerCase());
  }
  if (parts[0].match(/^\(\d+\)$/)) {
    is.push(`part-${assertDefined(parts.shift()).slice(1, -1)}`);
  }
  if (parts[0].match(/^\d+x$/)) {
    is.push(assertDefined(parts.shift()).toLowerCase());
  }

  const startBracket = parts.findIndex((x) => x.startsWith("("));
  if (startBracket !== -1) {
    const bracketed = parts.splice(startBracket, parts.length).join(" ").slice(1, -1);
    has.push(
      ...bracketed
        .split(",")
        .map((x) => normalizeStarshipChars(x))
        .filter(Boolean),
    );
  }

  return {
    label: normalizeStarshipChars(parts.join("-")),
    is,
    has,
  };
}

export const rootFilenameRegex = /^(\d+x\d+)(.*)\.png$/;

export function metaFromRootFilename(matched: RegExpMatchArray): FileMeta {
  const srcName = matched[0];
  const gridDim = matched[1].split("x").map((x) => Number(x) / 5) as [number, number];
  const id = -1;
  const ids = [id];
  const description = normalizeStarshipChars(matched[2]);
  const dstName = `${gridDim[0]}x${gridDim[1]}${description ? `--${description}` : ""}.png`;
  return { srcName, dstName, id, gridDim, is: ["root"], has: [], ids };
}

export const geomorphsFilenameRegex = /^([A-Z]+)?([\d,]+) \[(\d+x\d+)\] ([^(]*)(.*)\.png$/;

export function metaFromGeomorphFilename(matched: RegExpMatchArray): FileMeta {
  const srcName = matched[0];
  const ids = matched[1] ? [-1] : matched[2].split(",").map(Number);
  const id = ids[0];
  const extendedId = matched[1] ? `${matched[1]}${matched[2]}` : undefined;
  const gridDim = matched[3].split("x").map((x) => Number(x) / 5) as [number, number];
  const description = matched[4].concat(matched[5]);
  const { label, is, has } = extractGeomorphInfo(description);
  const dstName = `g-${extendedId || matched[2].split(",")[0]}--${label}.png`;
  return { srcName, dstName, id, gridDim, is, has, ids, extendedId };
}

/**
 * [1: category] [2: local_id][3: a-z]? [4: subcategory ]?[5: width*height][6: meta].png
 */
export const symbolsFilenameRegex = /^(.*) (\d+)([a-z])? (?:(.+) )?\[(\d+x\d+)\](.*)\.png$/;

export function metaFromSymbolFilename(matched: RegExpMatchArray): FileMeta {
  let category = normalizeStarshipChars(matched[1]);
  if (matched[4]) category += `-${normalizeStarshipChars(matched[4])}`;
  const id = Number(matched[2]);
  const ids = [id];
  const gridDim = matched[5].split("x").map((x) => Number(x) / 5) as [number, number];
  // ids are local unlike geomorphs
  const is: string[] = [];
  const has: string[] = [];
  if (matched[3]) is.push(`part-${matched[3]}`);
  if (matched[6]) {
    is.push(normalizeStarshipChars(matched[6]));
    has.push(...matched[6].split(",").map(normalizeStarshipChars));
  }
  return {
    srcName: matched[0],
    dstName: `${category}--${matched[2]}--${gridDim[0]}x${gridDim[1]}.png`,
    id,
    gridDim,
    is,
    has,
    ids,
  };
}

/**
 * [1: category] [2: width*height].png
 */
export const altSymbolsFilenameRegex = /^(.*) \[(\d+x\d+)\]\.png$/;

export function metaFromAltSymbolFilename(matched: RegExpMatchArray): FileMeta {
  const category = normalizeStarshipChars(matched[1]);
  const gridDim = matched[2].split("x").map((x) => Number(x) / 5) as [number, number];
  return {
    srcName: matched[0],
    dstName: `${category}--${gridDim[0]}x${gridDim[1]}.png`,
    id: -1,
    gridDim,
    is: [],
    has: [],
    ids: [-1],
  };
}

export const smallCraftFilenameRegex = /^(.*).png$/;

export function metaFromSmallCraftFilename(matched: RegExpMatchArray): FileMeta {
  return {
    srcName: matched[0],
    dstName: `${normalizeStarshipChars(matched[1])}--small-craft.png`,
    id: -1,
    /** Unfortunately, grid dimension not provided in original filename. */
    gridDim: [0, 0],
    is: [],
    has: [],
    ids: [-1],
  };
}

function normalizeStarshipChars(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[ -]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/**
 * Logs std{out,err} with `label` prefix.
 * Options can be provided as single args like `--quality=75`.
 */
export async function labelledSpawn(
  label: string,
  command: string,
  ...args: string[]
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = childProcess.spawn(command, args);
    proc.stdout.on("data", (data) =>
      (data.toString() as string)
        .trimEnd()
        .split("\n")
        .forEach((line) =>
          console.log(`[${ansi.Bold}${label}${ansi.Reset}]`, `${line}${ansi.Reset}`),
        ),
    );
    // stderr needn't contain error messages
    proc.stderr.on("data", (data) =>
      (data.toString() as string)
        .trimEnd()
        .split("\n")
        .forEach((line) =>
          console.log(`[${ansi.Bold}${label}${ansi.Reset}]`, `${line}${ansi.Reset}`),
        ),
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

/** Read file as string, or `null` on error. */
export async function tryReadString(filePath: string): Promise<string | null> {
  try {
    return (await fs.promises.readFile(filePath)).toString();
  } catch {
    // assume doesn't exist
    return null;
  }
}

interface FilenameMeta {
  label: string;
  is: string[];
  has: string[];
}

export interface FileMeta {
  srcName: string;
  /** Numeric identifier from Starship Geomorphs 2.0 */
  id: number;
  /** Sometimes a range is given */
  ids: number[];
  extendedId?: string;
  /** Dimension in grid squares of Starship Geomorphs 2.0 */
  gridDim: [number, number];
  dstName: string;
  is: string[];
  has: string[];
}
