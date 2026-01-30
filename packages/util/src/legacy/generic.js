// import safeStableStringify from "safe-stable-stringify";
import { stringify as javascriptStringify } from "javascript-stringify";
import prettyCompact from "json-stringify-pretty-compact";
import "./global.d";

/**
 * @template {{ key: string }} LookupItem
 * @param {LookupItem} newItem
 * @param {KeyedLookup<LookupItem>} lookup
 * @returns {KeyedLookup<LookupItem>}
 */
export function addToLookup(newItem, lookup) {
  return { ...lookup, [newItem.key]: newItem };
}

/**
 * JSDoc types lack a non-null assertion.
 * https://github.com/Microsoft/TypeScript/issues/23405#issuecomment-873331031
 *
 * Throws if the supplied value is _undefined_ (_null_ is allowed).\
 * Returns (via casting) the supplied value as a T with _undefined_ removed from its type space.
 * This informs the compiler that the value cannot be _undefined_.
 * @template T
 * @param {T} value
 * @param {string} [valueName]
 * @returns {T extends undefined ? never : T}
 */
export function assertDefined(value, valueName) {
  if (value === undefined) {
    throw new Error(
      `Encountered unexpected undefined value${valueName ? ` for '${valueName}'` : ""}`,
    );
  }
  return /** @type {*} */ (value);
}

/**
 * JSDoc types lack a non-null-or-undefined assertion.
 * https://github.com/Microsoft/TypeScript/issues/23405#issuecomment-873331031
 * @template T
 * @param {T} value
 * @returns {T extends undefined | null ? never : T}
 */
export function assertNonNull(value, ensureNull = true) {
  if (ensureNull === true && value == null) {
    throw new Error(`Encountered unexpected null or undefined value`);
  }
  return /** @type {*} */ (value);
}

/**
 * @template T
 * @param {T[]} items
 * @param {(x: T, y: T) => boolean} related
 * @returns {T[][]}
 */
export function computeCliques(items, related) {
  return items.reduce(
    (agg, item) => {
      for (const clique of agg) {
        if (clique.some((x) => related(item, x))) {
          clique.push(item);
          return agg;
        }
      }
      agg.push([item]); // New clique
      return agg;
    },
    /** @type {T[][]} */ ([[]]),
  );
}

/**
 *
 * @param {any} obj
 * @param {string[]} path
 * @returns
 */
export function deepGet(obj, path) {
  return path.reduce((agg, part) => agg[part], obj);
}

/**
 * Iterate deep keys separated by `/`.
 * https://stackoverflow.com/a/65571163/2917822
 * @param {any} t
 * @param {string[]} path
 * @returns {IterableIterator<string>}
 */
function* deepKeys(t, path = []) {
  switch (t?.constructor) {
    case Object:
      for (const [k, v] of Object.entries(t)) yield* deepKeys(v, [...path, k]);
      break;
    default:
      yield path.join("/");
  }
}

/**
 * Test equality, i.e. test fn `equality`,
 * falling back to primitive equality,
 * and recurse on arrays/objects.
 * @param {*} x
 * @param {*} y
 * @returns {boolean}
 */
export function equals(x, y, depth = 0) {
  if (depth > 10) {
    throw Error("equals: recursive depth exceeded 10");
  }
  if (x !== undefined && y === undefined) {
    return false;
  } else if (typeof x?.equals === "function") {
    return x.equals(y) === true;
  } else if (Array.isArray(x)) {
    return x.every((u, i) => equals(u, y[i]), depth + 1) && x.length === y.length;
  } else if (isPlainObject(x)) {
    return (
      Object.keys(x).every((key) => equals(x[key], y[key]), depth + 1) &&
      Object.keys(x).length === Object.keys(y).length
    );
  } else {
    return x === y;
  }
}

/**
 * Returns a hash code from serializable object
 * - 🔔 `prettyCompact` is useful when it corresponds to file contents
 * @param  {any} json A serializable object
 * @return {number} A 32bit integer
 * @see http://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/
 * @see https://stackoverflow.com/a/8831937/2917822
 */
export function hashJson(json, pretty = true) {
  return hashText((pretty ? prettyCompact : JSON.stringify)(json));
}

/**
 * Returns a hash code from a string
 * @param  {string} str The string to hash.
 * @return {number} A 32bit integer
 * @see http://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/
 * @see https://stackoverflow.com/a/8831937/2917822
 */
export function hashText(str) {
  let hash = 0;
  for (let i = 0, len = str.length; i < len; i++) {
    const chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

/**
 * https://github.com/sindresorhus/is-plain-obj/blob/main/index.js
 * @param {*} value
 * @returns
 */
export function isPlainObject(value) {
  if (Object.prototype.toString.call(value) !== "[object Object]") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

/**
 * @template T
 * @param {(T | T[])[]} items
 */
export function flatten(items) {
  return /** @type {T[]} */ ([]).concat(...items);
}

/**
 * @template T
 * @param {T[]} items
 * @returns {T | undefined}
 */
export function last(items) {
  return items[items.length - 1];
}

/**
 * Clone serializable data `input`, e.g. not regexes.
 * @template T
 * @param {T} input
 * @returns {T}
 */
export function deepClone(input) {
  return JSON.parse(JSON.stringify(input));
}

/**
 * @template {string | number} K
 * @template {any} V
 * @param {Partial<Record<K, V>> | Record<K, V>} record
 */
export function entries(record) {
  return /** @type {[K, V][]} */ (Object.entries(record));
}

/**
 * @template {string | number} K
 * @template {any} V
 * @param {[K, V][]} pairs
 * @returns {Record<K, V>}
 */
export function fromEntries(pairs) {
  return /** @type {Record<K, V>} */ (Object.fromEntries(pairs));
}

/**
 * Convert a function, regexp or string into a 'selector'.
 * - for functions we merely prefix args `extraArgs`
 * - for strings we support e.g.
 *   - `foo.bar.baz` -> function (x) { return x.foo.bar.baz }
 *   - `foo.bar.baz` -> function (x) { return x.foo.bar.baz() }
 *   - `foo.bar baz qux` -> function (x) { return x.foo.bar(baz, qux) }
 *
 * Technically the latter selectors are dependent on the particular value of `x`.
 * But in practice we can often expect them to act uniformly like the examples above.
 *
 * In strict mode we throw on resolve `undefined`.
 *
 * @param {((x: any) => any) | string | RegExp} selector
 * @param {any[]} [extraArgs]
 * @param {boolean} [strict]
 * @returns {(x: any, ...xs: any[]) => any}
 */
export function generateSelector(selector, extraArgs, strict = false) {
  if (typeof selector === "string") {
    /** @param {any} x @param {any[]} _xs */
    return function selectByStr(x, ..._xs) {
      const selected = /** @type {string} */ (selector)
        .split(".")
        .reduce(
          (agg, part) => (x = agg)[part], // x is parent of possible function
          /** @type {*} */ (x),
        );
      if (strict === true && typeof selected === "undefined") {
        throw Error(`selector not found: ${selector}`);
      }
      // If we selected a function, invoke it
      return typeof selected === "function" ? selected.call(x, ...(extraArgs ?? [])) : selected; // 🔔 permits using args supplied elsewhere
    };
  }
  if (typeof selector === "function") {
    if (selector.constructor.name === "AsyncFunction") {
      /** @param {any} x @param {any[]} xs */
      return async function selectByFn(x, ...xs) {
        return /** @type {(...args: any[]) => any} */ (selector)(x, ...(extraArgs ?? []), ...xs);
      };
    } else {
      /** @param {any} x @param {any[]} xs */
      return function selectByFn(x, ...xs) {
        return /** @type {(...args: any[]) => any} */ (selector)(x, ...(extraArgs ?? []), ...xs);
      };
    }
  }
  if (selector instanceof RegExp) {
    /** @param {string} x @param {any[]} _xs */
    return function selectByRegexp(x, ..._xs) {
      // 🚧 support extraArgs e.g. extract via '$2 $1'
      return selector.test.call(selector, typeof x === "string" ? x : jsStringify(x));
    };
  }
  if (selector === undefined) {
    return (x) => x;
  }
  throw Error(`selector ${selector} should be a function, regexp or string`);
}

/**
 * Assumes items have a property named `key`.
 * @template {string | number} Key
 * @template {{ key: Key }} Item
 * @param {Item[]} items
 * @returns {Record<Key, Item>}
 */
export function keyedItemsToLookup(items) {
  return items.reduce(
    (agg, item) => ({
      ...agg,
      [item.key]: item,
    }),
    /** @type {Record<Key, Item>} */ ({}),
  );
}

/**
 * @template {string | number} K
 * @param {Partial<Record<K, any>> | Record<K, any>} record
 * Typed `Object.keys`, usually as finitely many string literals.
 * Technically always returns a string, yet may have type `number`.
 */
export function keys(record) {
  return /** @type {K[]} */ (Object.keys(record));
}

/**
 * @param {any} obj
 * @returns {string[]}
 */
export function keysDeep(obj) {
  return Array.from(deepKeys(obj));
}

export function isDevelopment() {
  return import.meta.env.NODE_ENV !== "production";
}

/** https://stackoverflow.com/a/11979803/2917822 */
export function isInsideWebWorker() {
  return typeof self !== "undefined" && self.document === undefined;
}

/** @param {string} input  */
export function isStringInt(input) {
  return String(parseInt(input)) === input;
}

/**
 * Outputs JS expressions.
 * @param {*} input
 * @returns {string}
 */
export function jsStringify(input, pretty = false, suppressFunctions = false) {
  return (
    javascriptStringify(
      input,
      (value, _indent, stringify) => {
        // use double-quotes instead of single-quotes
        if (typeof value === "string") {
          return '"' + value.replace(/"/g, '\\"') + '"';
        }
        if (value instanceof Promise) {
          return "{ /* Promise */ }";
        }
        if (suppressFunctions === true && typeof value === "function") {
          //return `function () { /* Function ${value.name} */ }`;
          //return `function ${(value.name + 'Mock').replace(/\./g, '_')}() {}`;
          return `function () { /* Mock Function ${value.name} */ }`;
        }
        if (typeof value?._internalRoot === "object") {
          return undefined;
        }
        return stringify(value);
      },
      pretty === true ? 2 : undefined,
    ) ?? ""
  );
}

/**
 * Outputs JS expressions, with toString fallback.
 * @param {*} input
 * @returns {string}
 */
export function safeJsStringify(input) {
  try {
    return jsStringify(input);
  } catch {
    return `${input}`;
  }
}

/**
 * @template SrcValue
 * @template DstValue
 * @template {string | number} Key
 * @param {Record<Key, SrcValue>} input
 * @param {(value: SrcValue, key: Key) => DstValue} transform
 * Given `{ [key]: value }`, returns fresh
 * `{ [key]: _transform_(value) }`.
 */
export function mapValues(input, transform) {
  const output = /** @type {Record<Key, DstValue>} */ ({});
  keys(input).forEach((key) => void (output[key] = transform(input[key], key)));
  return output;
}

/**
 * Parse args as a single JavaScript object.
 * - 'foo:bar baz:qux' -> { "foo": "bar", "baz": "qux" }
 * - 'foo:42 bar' -> { "foo": 42, "bar": true }
 *
 * We assume
 * - keys do not contain the double-quote character.
 * - keys should not begin with single character '{'.
 *
 * @template {Record<string, any>} [T=Record<string, any>]
 * @param {string[]} args
 * @param {{ [aliasKey: string]: string; }} [alias]
 * Map alias keys to their true keys.
 * @param {{
 *   array?: { [key: string]: true };
 * }} [opts]
 * - `opts.array` if value isn't an array try to convert space-separated js values into one
 * @returns {T}
 */
export function jsArg(args, alias, opts) {
  return /** @type {T} */ (
    args.reduce(
      (agg, arg) => {
        const colonIndex = arg.indexOf(":");
        if (colonIndex === -1) {
          agg[arg] = true;
        } else {
          let key = arg.slice(0, colonIndex);
          if (key.startsWith("{")) {
            throw Error(`${key}: bad key (try quotes)`);
          }

          key = alias?.[key] ?? key;

          let value = parseJsArg(arg.slice(colonIndex + 1));

          if (opts?.array?.[key] === true && Array.isArray(value) === false) {
            value = parseJsArg(`[${arg.slice(colonIndex + 1).split(/\s+/)}]`);
          }

          agg[key] = value;
        }
        return agg;
      },
      /** @type {Record<string, any>} */ ({}),
    )
  );
}

/**
 * Parse input with string fallback (by default)
 * - preserves `undefined` (by default)
 * - preserves empty-string (by default)
 * @param {string} [input]
 */
export function parseJsArg(input) {
  try {
    if (input === "") return input;
    return Function(`return ${input}`)();
  } catch (e) {
    return input;
  }
}

/**
 * Parse input with context with string fallback
 * - preserves `undefined`
 * - preserves empty-string
 * @param {string} [input]
 * @param {string[]} names
 * @param {any[]} values
 */
export function parseJsWithCt(input, names = [], values = []) {
  try {
    if (input === "") return input;
    // eslint-disable-next-line no-new-func
    return Function(...names, `return ${input}`)(...values);
  } catch (e) {
    return input;
  }
}

/**
 * JSON.parse with string fallback
 * @template T
 * @param {string} input
 * @returns {T | string}
 */
export function parseJsonArg(input) {
  try {
    //@ts-expect-error // 🚧
    return input === undefined ? undefined : JSON.parse(input);
  } catch {
    return input;
  }
}

/** @returns {Promise<void>} */
export function pause(ms = 0) {
  return new Promise((r) => setTimeout(() => r(), ms));
}

/** @param {number} n */
export function range(n) {
  return [...Array(n)].map((_, i) => i);
}

/**
 * @template T
 * @param {T[]} items
 */
export function removeDups(items) {
  return Array.from(new Set(items));
}

/**
 * Remove the _first_ occurrence of `elem` from _`array`_,
 * **mutating** the latter if the former exists.
 * @template T
 * @param {T[]} array
 * @param {T} elem
 */
export function removeFirst(array, elem) {
  const firstIndex = array.indexOf(elem);
  if (firstIndex !== -1) {
    array.splice(firstIndex, 1);
  }
  return array;
}

/**
 * Remove the _last_ occurrence of `elem` from _`array`_,
 * **mutating** the latter if the former exists.
 * @template T
 * @param {T[]} array
 * @param {T} elem
 */
export function removeLast(array, elem) {
  const lastIndex = array.lastIndexOf(elem);
  if (lastIndex !== -1) {
    array.splice(lastIndex, 1);
  }
  return array;
}

/**
 * @template {{ key: string }} LookupItem
 * @param {string} itemKey
 * @param {KeyedLookup<LookupItem>} lookup
 * @returns {KeyedLookup<LookupItem>}
 */
export function removeFromLookup(itemKey, lookup) {
  const { [itemKey]: _, ...rest } = lookup;
  return rest;
}

/**
 * @param {*} input
 */
export function safeJsonCompact(input) {
  // return prettyCompact(JSON.parse(safeStableStringify(input) ?? ''));
  return prettyCompact(parseJsArg(javascriptStringify(input) ?? ""));
}

/** @param {string} input */
export function safeJsonParse(input) {
  try {
    return JSON.parse(input);
  } catch {
    warn(`failed to JSON.parse: "${input}"`);
    return undefined;
  }
}

/**
 * e.g. `foo bar=baz qux='1 2 3'` yields
 * > `foo`, `bar=baz`, `qux='1 2 3'`
 */
const splitTagRegex = /[^\s=]+(?:=(?:(?:'[^']*')|(?:[^']\S*)))?/gi;

/**
 * e.g. `foo bar=baz qux='1 2 3'` yields
 * > `['foo', 'bar=baz', 'qux='1 2 3' ]`
 * @param {string} text
 */
export function textToTags(text) {
  return [...text.matchAll(splitTagRegex)].map((x) => x[0]);
}

/**
 * e.g. `['foo', 'bar=baz', 'qux='1 2 3' ]` yields:
 * > `{ foo: true, bar: 'baz', qux: '1 2 3' }`
 * @param {string[]} tags
 * @param {Meta} [baseMeta]
 * @param {string[]} [names]
 * @param {any[]} [values]
 * @returns {Meta}
 */
export function tagsToMeta(tags, baseMeta = {}, names, values) {
  return tags.reduce((meta, tag) => {
    const eqIndex = tag.indexOf("=");
    if (eqIndex > -1) {
      meta[tag.slice(0, eqIndex)] = parseJsWithCt(tag.slice(eqIndex + 1), names, values);
    } else {
      meta[tag] = true;
    }
    return meta;
  }, baseMeta);
}

/**
 * - Take the first element of the set, removing it in the process.
 * - Throws on empty-set.
 * @template T
 * @param {Set<T>} set
 * @returns {T}
 */
export function takeFirst(set) {
  for (const item of set) {
    set.delete(item);
    return item;
  }
  throw new Error(`cannot take from empty set`);
}

/**
 * Usage `default: throw testNever(x)`.
 * @param {never} x
 * @param {{ override?: string; suffix?: string }} [opts]
 * @returns {string}
 */
export function testNever(x, opts) {
  return (
    opts?.override ??
    `testNever: ${jsStringify(x)} not implemented${opts?.suffix ? ` (${opts.suffix})` : ""}`
  );
}

/**
 * @param {number} number
 * @param {number} [decimalPlaces] default 2
 */
export function toPrecision(number, decimalPlaces = 2) {
  return Number(number.toFixed(decimalPlaces));
}

/**
 * @param {string} text
 * @returns
 */
export function truncateOneLine(text, maxLength = 50) {
  text = text.trimStart();
  const isLong = text.length > maxLength;
  return isLong ? `${text.split("\n", 1)[0].slice(0, maxLength)} ...` : text;
}

/**
 * @template {string} T
 * @param {string} key
 * @returns {T | null}
 */
export function tryLocalStorageGet(key, logErr = false) {
  try {
    return /** @type {T} */ (localStorage.getItem(key));
  } catch (e) {
    logErr && console.error(e);
    return null;
  }
}

/**
 * @template T
 * @param {string} key
 * @returns {T | null}
 */
export function tryLocalStorageGetParsed(key, logErr = false) {
  try {
    return /** @type {T} */ JSON.parse(localStorage.getItem(key) ?? "");
  } catch (e) {
    logErr && console.error(e);
    return null;
  }
}

/**
 * @param {string} key
 */
export function tryLocalStorageRemove(key, logErr = true) {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    logErr && console.error(e);
  }
}

/**
 * @param {string} key
 * @param {string} value
 */
export function tryLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    debug(e);
  }
}

/**
 * Source:
 * - https://stackoverflow.com/a/51396686/2917822
 * - https://blog.jonnew.com/posts/poo-dot-length-equals-two
 *
 * Apparently won't work for all unicode characters,
 * but perhaps we can restrict them.
 * @param {string} input
 */
export function visibleUnicodeLength(input) {
  const split = input.split("\u{200D}");
  return (
    split.reduce(
      (sum, item) => sum + Array.from(item.split(/[\ufe00-\ufe0f]/).join("")).length,
      0,
    ) / split.length
  );
}

//#region logging

/**
 * https://stackoverflow.com/a/26078207/2917822
 * @type {(...args: any[]) => void}
 */
export const debug = (() =>
  Function.prototype.bind.call(console.debug, console, "\x1b[36mDEBUG\x1b[0m"))();

/** @param {string} text */
export function yellow(text) {
  return `\x1b[33m${text}\x1b[0m`;
}

/**
 * https://stackoverflow.com/a/26078207/2917822
 * @type {(...args: any[]) => void}
 */
export const error = (() =>
  Function.prototype.bind.call(console.error, console, "\x1b[31mERROR\x1b[0m"))();

/**
 * https://stackoverflow.com/a/26078207/2917822
 * @type {(...args: any[]) => void}
 */
export const info = (() =>
  Function.prototype.bind.call(console.info, console, "\x1b[34mINFO\x1b[0m"))();

/**
 * https://stackoverflow.com/a/26078207/2917822
 * @type {(...args: any[]) => void}
 */
export const warn = (() =>
  Function.prototype.bind.call(console.warn, console, "\x1b[33mWARN\x1b[0m"))();

//#endregion

/**
 * @template {{ key: K}} Value
 * @template {string | number} [K=string|number]
 * @typedef KeyedLookup
 * @type {{ [key: string]: Value }}
 */

/**
 * @template {Record<string, any>} T
 * @typedef KeyedTrue
 * @type {{ [Key in keyof T]?: true }}
 */
