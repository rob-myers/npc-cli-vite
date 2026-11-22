import { Tooltip } from "@base-ui/react/tooltip";
import { CaretRightIcon } from "@phosphor-icons/react";
import LiteYouTubeEmbed from "react-lite-youtube-embed";
import "react-lite-youtube-embed/dist/LiteYouTubeEmbed.css";

/** Each screenshot's url by its repo path, e.g. `docs/screenshots/initial-vid-3.webp`, as the README has it */
const screenshotUrls = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../../../../docs/screenshots/*.{webp,png,jpg}", {
      eager: true,
      query: "?url",
      import: "default",
    }),
  ).map(([path, url]) => [path.replace(/^(\.\.\/)+/, ""), url]),
);

/** Themes `about.mdx` as WorldMenu, in place of the blog's `prose` */
export const aboutComponents = {
  a: (props: React.ComponentProps<"a">) => (
    <a
      {...props}
      className="text-amber-300 hover:text-amber-200 underline underline-offset-2"
      target="_blank"
      rel="noreferrer"
    />
  ),
  strong: (props: React.ComponentProps<"strong">) => <strong {...props} className="font-medium text-white" />,
  h2: (props: React.ComponentProps<"h2">) => (
    <h2 {...props} className="mt-2 text-xs font-medium uppercase tracking-wider text-neutral-400 first:mt-0" />
  ),
  /** e.g. `<Abbr title="Non Player Character">NPC</Abbr>` */
  Abbr: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={<abbr />}
        className="no-underline cursor-crosshair border-b border-dotted border-neutral-500 data-popup-open:text-amber-300"
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        {/* above the modal's z-10000 */}
        <Tooltip.Positioner className="z-10001" side="right" sideOffset={4}>
          <Tooltip.Popup className="px-2 py-1 rounded border border-neutral-700 bg-neutral-800 text-xs text-neutral-200 shadow-lg shadow-black/50">
            {title}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  ),
  ul: (props: React.ComponentProps<"ul">) => (
    <ul {...props} className="flex flex-col gap-1.5 pl-4 list-disc marker:text-neutral-600" />
  ),
  /** Open at first, and foldable */
  Notices: ({ children }: { children: React.ReactNode }) => (
    <details open className="group border-t border-neutral-800 pt-4 text-sm leading-relaxed text-neutral-400">
      <summary className="flex items-center gap-1.5 cursor-pointer list-none text-xs font-medium uppercase tracking-wider text-neutral-400 hover:text-neutral-200">
        <CaretRightIcon className="size-3 transition-transform group-open:rotate-90" weight="bold" />
        Notices and licenses
      </summary>
      <div className="flex flex-col gap-2 pt-3">{children}</div>
    </details>
  ),
  /** e.g. `<Screenshot src="docs/screenshots/initial-vid-3.webp" caption="…" />`, its `src` from the repo root */
  Screenshot: ({ src, alt, caption }: { src: string; alt?: string; caption?: string }) => (
    <figure className="flex flex-col gap-1.5 shrink-0 w-full snap-center">
      <img
        src={screenshotUrls[src] ?? src}
        alt={alt ?? caption ?? ""}
        loading="lazy"
        className="w-full rounded border border-neutral-800"
      />
      {caption !== undefined && <figcaption className="text-xs text-neutral-500">{caption}</figcaption>}
    </figure>
  ),
  /** Screenshots side by side, scrolled one at a time */
  Screenshots: ({ children }: { children: React.ReactNode }) => (
    <div className="shrink-0 flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-thin">{children}</div>
  ),
  Video: ({ id, title }: { id: string; title?: string }) => (
    <div className="shrink-0 overflow-hidden rounded border border-neutral-800">
      <LiteYouTubeEmbed id={id} title={title ?? "YouTube video"} poster="hqdefault" webp />
    </div>
  ),
};
