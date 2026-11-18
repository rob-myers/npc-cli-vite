import { cn } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { hashText } from "@npc-cli/util/legacy/generic";
import { CaretDownIcon, CaretUpIcon, CheckIcon, CopyIcon, PlayIcon } from "@phosphor-icons/react";
import { type ComponentProps, isValidElement, useContext, useMemo, useState } from "react";
import { ArticleContext } from "./context";
import { type Example, type SrcSegment, splitExamples, toSegments } from "./shell";
import { tokenCss } from "./shell-highlight";

/** An article's `pre`: a shell fence's commands run on a click, any other fence is shown as is */
export function ShellFence(props: ComponentProps<"pre">) {
  const code = props.children;
  if (
    isValidElement<{ className?: string; children?: unknown }>(code) &&
    typeof code.props.children === "string" &&
    (code.props.className === undefined || shellClasses.has(code.props.className))
  ) {
    return <ShellCommands src={code.props.children} />;
  }
  return <pre {...props} />;
}

function ShellCommands({ src }: { src: string }) {
  const { articleKey } = useContext(ArticleContext);
  /** By its original, so an amendment can attach to it */
  const fenceId = `${articleKey}#${(hashText(src) >>> 0).toString(36)}`;
  /** Highlighted once, rather than per render */
  const commands = useMemo(
    () => splitExamples(fenceId, src.split("\n")).map((example) => ({ example, segments: toSegments(example) })),
    [fenceId, src],
  );

  return (
    <div data-fence-id={fenceId} className="not-prose my-3 py-1 rounded border border-term-border-subtle bg-term-fence">
      {commands.map(({ example, segments }) => (
        <ShellCommand key={example.id} example={example} segments={segments} />
      ))}
    </div>
  );
}

/** Its comment, a run button on its left, copy and expand on its right. Expanded, its command shows beneath */
function ShellCommand({ example, segments }: { example: Example; segments: SrcSegment[] }) {
  const { copiedSrc, copy, ranId, run } = useContext(ArticleContext);
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded(!expanded);
  const { src } = example;
  /** Without a comment, its command is shown in its place */
  const commented = example.commentLines.length > 0;
  const command = (
    <code className={cn(codeCss, "min-w-0")}>
      {segments.map((segment, i) => (
        <span key={i} className={segment.arg === "key" ? "text-term-accent" : tokenCss[segment.kind]}>
          {segment.text}
        </span>
      ))}
    </code>
  );

  return (
    <div
      className={cn(
        "px-3 py-1 border border-transparent", // bordered throughout, so gaining the colour shifts nothing
        example.id === ranId && "border-term-ok/50 bg-term-ok/10",
        example.blankBefore > 0 && "mt-0.5",
        // run, comment, then copy and expand. Expanded, its command goes under the comment
        "grid grid-cols-[auto_1fr_auto] items-center gap-x-2",
      )}
    >
      <button type="button" title="run" className={runButtonCss} onClick={() => run(example.id, src)}>
        <PlayIcon weight="fill" className={runIconCss} />
      </button>
      {commented ? (
        <code
          className={cn(codeCss, tokenCss.comment, "min-w-0 cursor-pointer translate-y-px")} // its glyphs sit high
          onClick={toggle}
        >
          {example.commentLines.join("\n")}
        </code>
      ) : (
        command
      )}
      <span className="flex items-center gap-0.5">
        <button type="button" title="copy" className={iconButtonCss} onClick={() => copy(src)}>
          {copiedSrc === src ? <CheckIcon className={cn(iconCss, "text-term-ok")} /> : <CopyIcon className={iconCss} />}
        </button>
        {commented && (
          <button
            type="button"
            title={expanded ? "hide command" : "show command"}
            className={iconButtonCss}
            onClick={toggle}
          >
            {expanded ? <CaretUpIcon className={iconCss} /> : <CaretDownIcon className={iconCss} />}
          </button>
        )}
      </span>
      {commented && expanded && <div className="col-start-2 col-span-2 mt-0.5">{command}</div>}
    </div>
  );
}

const touchDevice = isTouchDevice();
/** MDX's class for a fence's language, `sh` or the like */
const shellClasses = new Set(["language-sh", "language-bash"]);

const codeCss = cn(
  "block font-mono text-[13px]/[1.45] whitespace-pre-wrap wrap-break-word",
  touchDevice && "text-[15px]/[1.45]",
);
/** A copy or expand button, right of an example's comment */
const iconButtonCss = cn(
  "grid place-items-center rounded cursor-pointer text-term-faint transition-colors hover:text-term-foreground hover:bg-term-hover-strong",
  touchDevice ? "size-8" : "size-5",
);
const iconCss = touchDevice ? "size-4.5" : "size-3.5";
/** The run button, left of an example's comment, larger than the rest */
const runButtonCss = cn(
  "shrink-0 grid place-items-center rounded border border-term-border-subtle cursor-pointer text-term-muted transition-colors hover:text-term-ok hover:border-term-ok/50 hover:bg-term-ok/10",
  touchDevice ? "size-10" : "size-7",
);
const runIconCss = touchDevice ? "size-5" : "size-4";
