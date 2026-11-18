import { type ReactNode, useRef } from "react";

/** An icon and its label. A double-click opens it, as does a tap, but not a scroll */
export function DeskIcon({ children, label, onOpen }: { children: ReactNode; label: string; onOpen(): void }) {
  const downAt = useRef<null | { x: number; y: number }>(null);
  return (
    <button
      type="button"
      title={label}
      className="group skip-net-no-drag flex flex-col items-center gap-1 w-22 cursor-default outline-none select-none"
      onDoubleClick={onOpen}
      onPointerDown={(e) => void (downAt.current = { x: e.clientX, y: e.clientY })}
      onPointerUp={(e) => {
        const at = downAt.current;
        downAt.current = null;
        const tapped = at !== null && Math.hypot(e.clientX - at.x, e.clientY - at.y) < tapSlopPx;
        if (e.pointerType === "touch" && tapped) onOpen();
      }}
    >
      <span className="group-focus:invert">{children}</span>
      <span className="px-1 max-w-full truncate text-[11px] leading-tight bg-mac-window text-mac-text group-focus:bg-mac-select group-focus:text-mac-on-select">
        {label}
      </span>
    </button>
  );
}

export function ChatIcon() {
  return (
    <svg {...svgProps}>
      <path d="M4 6h24v15H14l-6 5v-5H4z" />
      <path d="M9 11h14M9 15h10" />
    </svg>
  );
}

export function DocumentIcon() {
  return (
    <svg {...svgProps}>
      <path d="M8 3h11l6 6v20H8z" />
      <path d="M19 3v6h6" />
      <path d="M11 14h10M11 18h10M11 22h7" />
    </svg>
  );
}

export function FolderIcon() {
  return (
    <svg {...svgProps}>
      <path d="M3 9h10l2 3h14v15H3z" />
      <path d="M3 12h26" />
    </svg>
  );
}

export function ItemIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="16" cy="17" r="11" />
      <path d="M16 17l6-6M16 6v3M27 17h-3M5 17h3" />
    </svg>
  );
}

/** How far a touch may move and still open an icon */
const tapSlopPx = 8;

/** Drawn in the desktop's greys, so they follow the theme */
const svgProps = {
  width: 32,
  height: 32,
  viewBox: "0 0 32 32",
  fill: "var(--color-mac-window)",
  stroke: "var(--color-mac-text)",
  strokeWidth: 1.5,
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;
