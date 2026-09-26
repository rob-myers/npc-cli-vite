import { Tooltip } from "@base-ui/react/tooltip";

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
  strong: (props: React.ComponentProps<"strong">) => <strong {...props} className="font-normal text-white" />,
  h2: (props: React.ComponentProps<"h2">) => (
    <h2 {...props} className="border-t border-neutral-800 pt-4 text-xs text-neutral-300 first:border-t-0 first:pt-0" />
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
  Notices: ({ children }: { children: React.ReactNode }) => (
    <div className="flex flex-col gap-2 border-t border-neutral-800 pt-4 text-xs text-neutral-400">{children}</div>
  ),
};
