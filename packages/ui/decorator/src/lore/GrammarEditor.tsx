import { cn } from "@npc-cli/util";
import { useRef } from "react";

/** A JSON textarea, coloured by a layer drawn beneath its own (transparent) text */
export function GrammarEditor(props: {
  value: string;
  invalid: boolean;
  readOnly: boolean;
  onChange(value: string): void;
}) {
  const under = useRef<HTMLPreElement>(null);
  return (
    <div
      className={cn(
        "relative h-48 resize-y overflow-hidden rounded border bg-zinc-900",
        props.invalid ? "border-red-500" : "border-zinc-800 focus-within:border-zinc-600",
      )}
    >
      <pre ref={under} aria-hidden className={cn(layerClass, "pointer-events-none overflow-hidden")}>
        {tokenize(props.value).map(({ text, kind }, i) => (
          <span key={i} className={tokenClass[kind]}>
            {text}
          </span>
        ))}
        {"\n"}
      </pre>
      <textarea
        className={cn(
          layerClass,
          "resize-none overflow-auto bg-transparent text-transparent caret-zinc-200 outline-none",
        )}
        spellCheck={false}
        wrap="off"
        readOnly={props.readOnly}
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value)}
        onScroll={(e) => under.current?.scrollTo(e.currentTarget.scrollLeft, e.currentTarget.scrollTop)}
      />
    </div>
  );
}

/** Both layers must lay text out identically */
const layerClass = "absolute inset-0 m-0 p-1 font-mono text-xs leading-5 whitespace-pre";

type Kind = "key" | "string" | "tag" | "action" | "punct" | "other";

const tokenClass: Record<Kind, string> = {
  key: "text-sky-300",
  string: "text-zinc-300",
  /** `#rule.mod#` */
  tag: "text-amber-300",
  /** `[name:…]` */
  action: "text-emerald-300",
  punct: "text-zinc-500",
  other: "text-red-300",
};

const jsonRe = /("(?:[^"\\\n]|\\.)*"?)(\s*:)?|([{}[\],:])|(\s+)|([^"{}[\],:\s]+)/g;
const traceryRe = /(#[^#"\s][^#"]*#)|(\[[^\][":]+:)|(\])/g;

/** Enough of JSON to colour a grammar; never fails, whatever is typed */
function tokenize(text: string) {
  const tokens: { text: string; kind: Kind }[] = [];
  for (const [, str, colon, punct, space, other] of text.matchAll(jsonRe)) {
    if (str !== undefined && colon !== undefined) {
      tokens.push({ text: str, kind: "key" }, { text: colon, kind: "punct" });
    } else if (str !== undefined) {
      let at = 0;
      for (const m of str.matchAll(traceryRe)) {
        if (m.index > at) tokens.push({ text: str.slice(at, m.index), kind: "string" });
        tokens.push({ text: m[0], kind: m[1] !== undefined ? "tag" : "action" });
        at = m.index + m[0].length;
      }
      if (at < str.length) tokens.push({ text: str.slice(at), kind: "string" });
    } else if (punct !== undefined) {
      tokens.push({ text: punct, kind: "punct" });
    } else {
      tokens.push({ text: space ?? other, kind: space !== undefined ? "punct" : "other" });
    }
  }
  return tokens;
}
