import { tw } from "@npc-cli/util";
import type { ReactNode } from "react";

/**
 * A section of an item's file under a heading, as an SCP's, e.g. `<FileSection title="addendum">…</FileSection>`.
 * An `id` lets a link reach it, e.g. `[see](#addendum)`.
 */
export function FileSection({ id, title, children }: { id?: string; title: string; children?: ReactNode }) {
  return (
    <section id={id} className="my-4 scroll-mt-2">
      <div className={headingClass}>
        <TapeTitle title={title} />
        <span aria-hidden className={ruleClass} />
      </div>
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

/** How an item is activated, where an SCP's file says how it is contained, e.g. its code fences */
export function ActivationProcedures({ children }: { children?: ReactNode }) {
  return (
    <FileSection id="activationprocedures" title="special activation procedures">
      {children}
    </FileSection>
  );
}

/** What an item is */
export function Description({ children }: { children?: ReactNode }) {
  return (
    <FileSection id="description" title="description">
      {children}
    </FileSection>
  );
}

/** Its title on a strip of tape, a little crooked */
export function TapeTitle({ title }: { title: string }) {
  /** The same for a title every render */
  const tilt = jitterOf(title) * 0.9;
  return (
    <span role="heading" aria-level={4} className={tapeClass} style={{ transform: `rotate(${tilt.toFixed(2)}deg)` }}>
      {title}
    </span>
  );
}

/** In `[-1, 1]`, from a hash of `text` */
function jitterOf(text: string) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) | 0;
  const x = Math.sin(h) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

const headingClass = tw("not-prose flex items-center gap-3 mb-2");
/** A plain strip, light grey in a light theme, near black in a dark one. It hangs left by its padding, so its letters align with the text below */
const tapeClass = tw(
  "shrink-0 -ml-3 px-3 py-0.5 bg-[#dedede] text-blue-800 dark:bg-[#151515] dark:text-blue-300 font-sans text-[13px] tracking-[0.18em]",
);
/** It shrinks away rather than overflow, e.g. under a part's floated dates */
const ruleClass = tw("h-px min-w-0 flex-1 bg-[color-mix(in_srgb,var(--color-mac-text)_35%,var(--color-mac-window))]");
const bodyClass = tw("*:first:mt-0 *:last:mb-0");
