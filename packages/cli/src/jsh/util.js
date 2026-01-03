/// <reference types="../legacy/npc.d.ts" />
import { speak } from "@npc-cli/util/legacy/dom";
import { ansi } from "../shell/const";
import { ttyError } from "../shell/shell";
import { stripAnsi } from "../shell/util";

/**
 * Execute a javascript function, e.g.
 * ```sh
 * call "() => 42"
 * call "({ home }) => home.foo"
 * call '({ args }) => `Hello, ${args[0]}`' Rob
 * ```
 * @param {NPC.RunArg} ct
 */
export async function* call(ct) {
  if (ct.args[0] in ct.lib) {
    const func = /** @type {*} */ (ct.lib)[ct.args[0]][ct.args[1]];
    yield await func(ct);
  } else {
    const func = Function(`return ${ct.args[0]}`)();
    ct.args = ct.args.slice(1);
    yield await func(ct);
  }
}

/**
 * Evaluate and return a javascript expression
 * ```sh
 * expr 2 ** 10
 * expr window.navigator.vendor
 * expr '((x) => [x, x, x])("a lady")'
 * ```
 * @param {NPC.RunArg} ctxt
 */
export const expr = ({ api, args }) => {
  const input = args.join(" ");
  return api.parseJsArg(input);
};

/**
 * Filter inputs
 * ```sh
 * seq 10 | filter 'x => !(x % 2)'
 * expr window | keysAll | split | filter /^n/
 * ```
 * @param {NPC.RunArg} ct
 */
export async function* filter(ct) {
  let { api, args, datum } = ct;
  const { operands, opts } = api.getOpts(args, { boolean: ["ansi"] });

  const func = api.generateSelector(
    api.parseFnOrStr(operands[0]),
    operands.slice(1).map(api.parseJsArg),
  );

  while ((datum = await api.read(true)) !== api.eof)
    if (api.isDataChunk(datum) === true)
      yield api.dataChunk(
        datum.items.filter((x) => func(opts.ansi === true ? stripAnsi(x) : x, ct)),
      );
    else if (func(opts.ansi === true ? stripAnsi(datum) : datum, ct)) yield datum;
}

/**
 * - Combines map (singleton), filter (empty array) and split (of arrays)
 * - Supports chunks
 *
 * ```sh
 * seq 5 | flatMap 'x => [...Array(x)].map((_, i) => i)'
 * { range 5; range 10; } | flatMap 'x => x'
 * expr '{ items: [1, 2, 3] }' | flatMap items
 * ```
 * @param {NPC.RunArg} ct
 */
export async function* flatMap(ct) {
  let { api, args, datum } = ct;
  let result;
  const func = api.generateSelector(api.parseJsArg(args[0]));
  while ((datum = await api.read(true)) !== api.eof) {
    if (api.isDataChunk(datum)) yield api.dataChunk(datum.items.flatMap((x) => func(x, ct)));
    else if (Array.isArray((result = func(datum, ct)))) yield* result;
    else yield result;
  }
}

/**
 * List global variables
 * @source https://stackoverflow.com/a/49069050/2917822
 *
 * Relevant for `expr` e.g.
 * ```sh
 * expr 'foo = 42'
 * expr foo # outputs number 42
 * expr 'delete foo'
 * expr foo # outputs string "foo"
 * ```
 */
export function* globals() {
  document.body.appendChild(document.createElement("div")).innerHTML =
    '<iframe id="globals-temp-iframe" style="display:none"></iframe>';

  const keys = /** @type {string[]} */ ([]);
  for (const key in window) {
    if (!(key in window.frames[window.frames.length - 1]) && String(Number(key)) !== key) {
      keys.push(key);
    }
  }

  document.body.removeChild(
    /** @type {HTMLElement} */ (document.getElementById("globals-temp-iframe")?.parentNode),
  );

  yield* keys;
}

/**
 * ```sh
 * # initially logs args, then stdin.
 * log $foo bar
 * seq 10 | log
 * ```
 * - ℹ️ `map console.log` would log 2nd arg too
 * - ℹ️ logs chunks larger than 1000, so e.g. `seq 1000000 | log` works
 * @param {NPC.RunArg} ctxt
 * @returns
 */
export async function* log({ api, args, datum }) {
  args.forEach((arg) => console.log(arg));
  if (api.isTtyAt(0)) return;
  while ((datum = await api.read(true)) !== api.eof) {
    if (api.isDataChunk(datum) && datum.items.length <= 1000) {
      datum.items.forEach((x) => console.log(x));
    } else {
      console.log(datum);
    }
  }
}

/**
 * Apply function to each item from stdin.
 * ```sh
 * seq 10 | map 'x => 2 ** x'
 * echo foo | map Array.from
 * expr window | map navigator.connection | log
 * ```
 * - ℹ️ To use `await`, the provided function must begin with `async`.
 * @param {NPC.RunArg} ct
 */
export async function* map(ct) {
  let { api, args, datum } = ct;
  const { operands, opts } = api.getOpts(args, { boolean: ["forever"] });

  /** @type {(x: any, ...xs: any[]) => any} */
  let func;
  let isNativeCode = false;
  let provideCount = true;

  if (operands[0] in ct.lib) {
    func = /** @type {*} */ (ct.lib)[operands[0]][operands[1]];

    // when more than 2 operands do not provide count to func,
    // so that `opts = api.jsArg(args)` works
    provideCount = operands.length <= 2;
  } else {
    const baseSelector = api.parseFnOrStr(operands[0]);
    func =
      typeof baseSelector === "string"
        ? // e.g. expr "{ foo: { inc: (x) => x+1  }  }" | map foo.inc 3
          api.generateSelector(baseSelector, operands.slice(1).map(api.parseJsArg))
        : // e.g. echo | map "(x, {args}) => args[1]" foo
          api.generateSelector(baseSelector);
    // fix e.g. `expr "new Set([1, 2, 3])" | map Array.from`
    isNativeCode = /\{\s*\[\s*native code\s*\]\s*\}$/m.test(`${baseSelector}`);
  }

  const isAsync = func.constructor.name === "AsyncFunction";
  let count = 0;

  if (isNativeCode === false) {
    let rejectLoop = /** @param {any} _e */ (_e) => {};
    /** In case we're waiting for read, provide escape hatch if reboot process */
    const rebootRejecter = new Promise((_, reject) => (rejectLoop = reject));
    api.handleStatus({
      cleanups() {
        rejectLoop(api.getKillError());
      },
    });

    while ((datum = await Promise.race([api.read(true), rebootRejecter])) !== api.eof) {
      try {
        if (api.isDataChunk(datum) === true) {
          if (isAsync === false) {
            // fast on chunks
            yield api.dataChunk(
              datum.items.map((x) => func(x, ct, provideCount === true ? count++ : undefined)),
            );
          } else {
            // unwind chunks
            for (const item of datum.items)
              yield await func(item, ct, provideCount === true ? count++ : undefined);
          }
        } else {
          yield await func(datum, ct, provideCount === true ? count++ : undefined);
        }
      } catch (e) {
        if (opts.forever === true) {
          ttyError(`${api.meta.stack.join(": ")}: ${e instanceof Error ? e.message : e}\n\n`, e);
          continue;
        }
        throw e;
      }
    }
  } else {
    while ((datum = await api.read()) !== api.eof) {
      try {
        yield await func(datum);
      } catch (e) {
        if (opts.forever === true) {
          ttyError(`${api.meta.stack.join(": ")}: ${e instanceof Error ? e.message : e}\n\n`, e);
          continue;
        }
        throw e;
      }
    }
  }
}

/**
 * Apply native or one-arg-function to each item from stdin.
 * ```sh
 * echo foo | mapBasic Array.from
 * ```
 * - ℹ️ We do not support chunks.
 * - ℹ️ To use `await`, the one-arg-function must begin with `async`.
 * @param {NPC.RunArg} ct
 */
export async function* mapBasic(ct) {
  let { api, args, datum } = ct;
  const { operands, opts } = api.getOpts(args, { boolean: ["forever"] });
  // e.g. "Array.from", "x => [x, x]"
  const func = Function(`return ${operands[0]}`)();

  while ((datum = await api.read()) !== api.eof) {
    try {
      yield await func(datum);
    } catch (e) {
      if (opts.forever === true) {
        api.writeError(`${api.meta.stack.join(": ")}: ${e instanceof Error ? e.message : e}`);
      } else {
        throw e;
      }
    }
  }
}

/**
 * Avoid using generator so we can override it.
 * ```sh
 * # list available voices (device dependent)
 * narrate list:voices
 *
 * # use different voices
 * narrate hi everyone voice:Aaron
 * narrate {1..10} as:'Bad News'
 * narrate {a..z} as:'Google UK English Female'
 * narrate words:"$( echo {1..5} )"
 * ```
 * @param {NPC.RunArg} ct
 * @param {{
 *   words?: string;
 *   voice?: string;
 *   list?: 'voices';
 *   onSay?(opts: { words: string; voice?: string; }): void | Promise<void>
 * }} [opts]
 */
export async function narrate({ api, args }, opts = api.jsArg(args, { as: "voice" })) {
  if (opts.list === "voices") {
    // List available voices
    return api.dataChunk(
      window.speechSynthesis
        .getVoices()
        .map(({ name, lang }) => `${name} (${ansi.YellowBright}${lang}${ansi.White})`),
    );
  }

  const handlers = api.handleStatus({
    cleanups() {
      window.speechSynthesis.cancel();
    },
    onResumes() {
      window.speechSynthesis.resume();
      return true;
    },
    onSuspends() {
      window.speechSynthesis.pause();
      return true;
    },
  });

  try {
    // 🔔 `narrate foo bar words:baz` say "baz"
    const words = opts.words ?? args.filter((x) => x in opts).join(" ");
    const voice = window.speechSynthesis.getVoices().find(({ name }) => name === opts.voice);

    window.speechSynthesis.cancel(); // always interrupt?

    if (words === "") {
      return;
    }

    // try fix intermittent loss of first word
    await speak(" ");
    await opts?.onSay?.({ voice: voice?.name, words });
    await speak(words, voice);
  } finally {
    handlers.dispose();
  }
}

/**
 * @param {NPC.RunArg} ct
 */
export async function pause(ct) {
  ct.api.pause();
  await ct.api.awaitResume();
  // yield; // blocking empty write
}

/**
 * @param {NPC.RunArg} ctxt
 */
export async function* poll({ api, args }) {
  yield* api.poll(args);
}

/**
 * Reduce all items from stdin
 * @param {NPC.RunArg} ct
 */
export async function* reduce({ api, args, datum }) {
  const inputs = []; // eslint-disable-next-line no-new-func
  const reducer = Function(`return ${args[0]}`)();
  while ((datum = await api.read(true)) !== api.eof)
    // Spread throws: Maximum call stack size exceeded
    if (api.isDataChunk(datum)) {
      datum.items.forEach((item) => inputs.push(item));
    } else {
      inputs.push(datum);
    }
  yield args[1] ? inputs.reduce(reducer, api.parseJsArg(args[1])) : inputs.reduce(reducer);
}

/**
 * Like `take` but outputs nothing.
 * @param {NPC.RunArg} ct
 */
export async function sink(ct) {
  for await (const _ of take(ct));
}

/**
 * Split arrays from stdin into items.
 * ```sh
 * expr '[1, 2, 3, 4]' | split
 * # optional selector applied pointwise,
 * expr '[{ meta: "foo" }, {meta: "bar" }]' | split meta
 * ```
 * Also, split strings by optional separator (default `''`), e.g.
 * ```sh
 * # split by comma
 * echo foo,bar,baz | split ,
 * # split by whitespace
 * echo foo   bar   baz | split '/\s+/'
 * ```
 * @param {NPC.RunArg} ct
 */
export async function* split({ api, args, datum }) {
  const splitStringArg = api.parseJsArg(args[0] || "");
  const selectorArg = api.generateSelector(api.parseFnOrStr(args[0] || ""), args.slice(1));

  while ((datum = await api.read()) !== api.eof) {
    if (Array.isArray(datum)) {
      // yield* datum
      yield api.dataChunk(args.length >= 1 ? datum.map(selectorArg) : datum);
    } else if (typeof datum === "string") {
      // yield* datum.split(arg)
      yield api.dataChunk(datum.split(splitStringArg));
    } else if (datum instanceof Set) {
      yield api.dataChunk(Array.from(datum));
    }
  }
}

/**
 * Collect stdin into a single array
 * @param {NPC.RunArg} ct
 */
export async function* sponge({ api, datum }) {
  const outputs = [];
  while ((datum = await api.read(true)) !== api.eof)
    if (api.isDataChunk(datum)) {
      // Spread throws: Maximum call stack size exceeded
      datum.items.forEach((item) => outputs.push(item));
    } else {
      outputs.push(datum);
    }
  yield outputs;
}

/**
 * Usage
 * - `poll 1 | while x=$( take 1 ); do echo ${x} ${x}; done`
 * @param {NPC.RunArg} ct
 */
export async function* take({ api, args, datum }) {
  try {
    let remainder = Number(args[0] || Number.POSITIVE_INFINITY);
    // 🔔 cannot support chunks if want pattern:
    // seq 5 | while take 1 >foo; do foo; done
    while (remainder-- > 0 && (datum = await api.read(false)) !== api.eof) {
      yield datum;
    }
    if (remainder >= 0) {
      throw api.getShError("", 1);
    }
  } catch (e) {
    throw e ?? api.getKillError();
  }
}
