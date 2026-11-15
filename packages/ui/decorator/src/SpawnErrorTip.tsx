import { Tooltip } from "@base-ui/react/tooltip";
import { cn } from "@npc-cli/util";
import { useEffect, useMemo, useRef } from "react";

/** Why a spawn failed, over where it was tried, until it closes itself. Kept inside the panel's `container` */
export function SpawnErrorTip({ error, container, toClient, onClose }: Props) {
  useEffect(() => {
    if (error === null) return;
    const timer = setTimeout(onClose, shownMs);
    return () => clearTimeout(timer);
  }, [error]);

  /** The last error, kept whilst it fades out */
  const last = useRef(error);
  if (error !== null) last.current = error;
  const shown = last.current;

  /** The map point on screen, read whenever the tip is placed */
  const anchor = useMemo(
    () =>
      shown && {
        getBoundingClientRect() {
          const p = toClient(shown.at.x, shown.at.y) ?? { x: 0, y: 0 };
          return new DOMRect(p.x, p.y);
        },
      },
    [shown],
  );

  return (
    <Tooltip.Root open={error !== null} onOpenChange={(open) => open || onClose()}>
      <Tooltip.Portal container={container}>
        <Tooltip.Positioner anchor={anchor} positionMethod="absolute" side="top" sideOffset={8} className="z-50">
          <Tooltip.Popup
            className={cn(
              "px-2 py-1 rounded border border-red-500/60 bg-zinc-900 text-xs text-red-300 shadow-lg",
              "transition-[opacity,translate] duration-200 data-ending-style:duration-700",
              "data-starting-style:opacity-0 data-starting-style:translate-y-1 data-ending-style:opacity-0",
            )}
          >
            {shown?.message}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

type Props = {
  /** A new object each failure, so a repeat shows afresh */
  error: null | { message: string; at: Geom.VectJson };
  container: null | HTMLElement;
  toClient(x: number, y: number): null | undefined | Geom.VectJson;
  onClose(): void;
};

const shownMs = 2500;
