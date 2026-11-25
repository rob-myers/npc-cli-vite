import { tw } from "@npc-cli/util";
import type { CSSProperties, ReactNode } from "react";

/** A section of an item's file under a heading, as an SCP's, e.g. `<FileSection title="addendum">…</FileSection>` */
export function FileSection({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="my-4">
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
  return <FileSection title="special activation procedures">{children}</FileSection>;
}

/** What an item is */
export function Description({ children }: { children?: ReactNode }) {
  return <FileSection title="description">{children}</FileSection>;
}

/** Its title punched into a strip of label-maker tape, a little crooked, its ends cut at an angle */
export function TapeTitle({ title }: { title: string }) {
  /** The same for a title every render */
  const tilt = jitterOf(title) * 0.9;
  return (
    <span
      role="heading"
      aria-level={4}
      className={tapeClass}
      style={{ transform: `rotate(${tilt.toFixed(2)}deg)`, "--grain": grainUrl } as CSSProperties}
    >
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

/** Fine grain on the tape's plastic */
const grainUrl = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .07 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>",
)}")`;

const headingClass = tw("not-prose flex items-center gap-3 mb-2");
/** Glossy black tape, its letters embossed white, its edges lined white, or black in a dark theme. Its grain is `--grain`, set inline, as a url in a class breaks the css */
const tapeClass = tw(
  "shrink-0 px-3 py-[3px] bg-[image:var(--grain),linear-gradient(to_bottom,#3a3a3a,#141414_55%,#0b0b0b)] [clip-path:polygon(4px_0,100%_0,calc(100%-4px)_100%,0_100%)] font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[#f1f1f1] [text-shadow:0_1px_0_rgb(0_0_0/0.9),0_-1px_0_rgb(255_255_255/0.25)] shadow-[inset_0_1px_0_rgb(255_255_255/0.3),inset_0_-1px_0_rgb(255_255_255/0.15)] dark:shadow-[inset_0_1px_0_#000,inset_0_-1px_0_#000]",
);
const ruleClass = tw("h-px min-w-6 flex-1 bg-[color-mix(in_srgb,var(--color-mac-text)_35%,var(--color-mac-window))]");
const bodyClass = tw("*:first:mt-0 *:last:mb-0");
