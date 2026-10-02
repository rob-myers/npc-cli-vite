/**
 * A small Tracery: `#rule#` expands to one of the rule's options, `#rule.mod#` modifies it, and
 * `[name:#rule#]` fixes a choice as `name` for the rest of the line — see `docs/manifest-lore.md`
 */
export type Grammar = Record<string, string[]>;

/** A missing rule, or one too deep, reads `((rule))` rather than throwing */
export function expand(grammar: Grammar, rule = "origin", rng: () => number = Math.random): string {
  return expandRule(rule, { grammar, fixed: {}, rng }, 0);
}

/** The same seed gives the same line */
export function seededRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctxt = { grammar: Grammar; fixed: Record<string, string>; rng: () => number };

const maxDepth = 30;

function expandRule(rule: string, ctxt: Ctxt, depth: number): string {
  if (rule in ctxt.fixed) return ctxt.fixed[rule];
  const options = ctxt.grammar[rule];
  if (options === undefined || options.length === 0 || depth > maxDepth) return `((${rule}))`;
  return expandText(options[Math.floor(ctxt.rng() * options.length)], ctxt, depth + 1);
}

function expandText(text: string, ctxt: Ctxt, depth: number): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length) {
      out += text[++i];
    } else if (c === "[") {
      const end = closingBracket(text, i);
      const colon = text.indexOf(":", i);
      if (end === -1 || colon === -1 || colon > end) {
        out += c;
        continue;
      }
      ctxt.fixed[text.slice(i + 1, colon).trim()] = expandText(text.slice(colon + 1, end), ctxt, depth);
      i = end;
    } else if (c === "#") {
      const end = text.indexOf("#", i + 1);
      if (end === -1) {
        out += c;
        continue;
      }
      const [rule, ...mods] = text.slice(i + 1, end).split(".");
      out += mods.reduce((s, mod) => modifiers[mod]?.(s) ?? s, expandRule(rule.trim(), ctxt, depth));
      i = end;
    } else {
      out += c;
    }
  }
  return out;
}

/** The `]` matching the `[` at `from`, else -1 */
function closingBracket(text: string, from: number) {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]" && --depth === 0) return i;
  }
  return -1;
}

const modifiers: Record<string, (s: string) => string> = {
  capitalize: (s) => s.charAt(0).toUpperCase() + s.slice(1),
  capitalizeAll: (s) => s.replace(/(^|\s)\S/g, (x) => x.toUpperCase()),
  a: (s) => (/^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`),
  s: (s) => (/(s|x|ch|sh)$/i.test(s) ? `${s}es` : /[^aeiou]y$/i.test(s) ? `${s.slice(0, -1)}ies` : `${s}s`),
};

/** Later grammars win, rule by rule */
export function mergeGrammars(...grammars: Grammar[]): Grammar {
  return Object.assign({}, ...grammars);
}

/** Each fact as a rule of one option, so `#role#` reads the entry's own `role` */
export function factsGrammar(facts: Record<string, string>): Grammar {
  return Object.fromEntries(Object.entries(facts).map(([key, value]) => [key, [value]]));
}
