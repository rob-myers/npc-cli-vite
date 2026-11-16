import { cn } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { hashText } from "@npc-cli/util/legacy/generic";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { type ComponentProps, isValidElement, useContext, useMemo } from "react";
import { type Example, type SrcSegment, splitExamples, toSegments } from "../library/library";
import { tokenCss } from "../library/shell-highlight";
import { ArticleContext } from "./context";

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
    () => splitExamples(fenceId, src.split("\n")).map((example) => ({ example, segments: toSegments(example, {}) })),
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

function ShellCommand({ example, segments }: { example: Example; segments: SrcSegment[] }) {
  const { copiedSrc, copy, ranId, run } = useContext(ArticleContext);
  const { src } = example;

  return (
    <div
      className={cn(
        "group/example relative px-3 py-1 cursor-pointer hover:bg-term-hover-strong",
        // bordered throughout, so gaining the colour shifts nothing
        "border border-transparent",
        example.id === ranId && "border-term-ok/50 bg-term-ok/10",
        example.blankBefore > 0 && "mt-0.5",
      )}
      onClick={() => run(example.id, src)}
    >
      {example.commentLines.length > 0 && (
        <div className="flex items-start">
          <span className={copyColumnCss} />
          <code className={cn(codeCss, tokenCss.comment, "flex-1 min-w-0")}>{example.commentLines.join("\n")}</code>
        </div>
      )}
      <div className="flex items-start">
        <span className={cn(copyColumnCss, "group-has-[button:hover]/example:text-term-foreground")}>
          {copiedSrc === src ? (
            <CheckIcon alt="copied" className="size-3.5 text-term-ok" />
          ) : (
            <CopyIcon alt="copy" className="size-3.5" />
          )}
        </span>
        <code className={cn(codeCss, "flex-1 min-w-0")}>
          {segments.map((segment, i) => (
            <span key={i} className={segment.arg === "key" ? "text-term-accent" : tokenCss[segment.kind]}>
              {segment.text}
            </span>
          ))}
        </code>
      </div>
      {/* the whole left column, so a tap near the icon copies rather than runs */}
      <button
        type="button"
        title="copy command"
        aria-label="copy command"
        className="absolute inset-y-0 left-0 w-10 cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          copy(src);
        }}
      />
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
/** Left of each line: the copy icon beside the command, empty beside its comment */
const copyColumnCss = cn(
  "shrink-0 w-7 h-[1.45em] flex items-center text-[13px]",
  touchDevice && "text-[15px]",
  "text-term-faint transition-colors",
);
