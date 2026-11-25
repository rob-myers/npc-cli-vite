import { cn, tw } from "@npc-cli/util";
import {
  CaretDownIcon,
  CaretUpIcon,
  CursorClickIcon,
  type Icon,
  KeyboardIcon,
  LightningIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ArticleContext } from "./context";

/**
 * An article's header as an octagonal drum on its side, a wide face per part, narrow blank ones between, turned by a drag, its arrows or arrow keys.
 * E.g. `<ItemHeader tags={["ui"]} activation={["code", "keys"]} />`, its item number the article's key unless given.
 */
export function ItemHeader({
  item,
  tags = [],
  activation = [],
}: {
  item?: string;
  tags?: string[];
  activation?: string[];
}) {
  const { articleKey } = useContext(ArticleContext);
  const faces: { label: string; content: ReactNode }[] = [
    { label: "item #", content: <span className="text-[13px] font-bold">{item ?? articleKey}</span> },
    {
      label: "tags",
      content: (
        <span className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={tag} className={tagClass}>
              {tag}
            </span>
          ))}
        </span>
      ),
    },
    {
      label: "activation",
      content: (
        <span className="flex flex-wrap gap-1.5">
          {activation.map((way) => {
            const WayIcon = activationIcons[way] ?? LightningIcon;
            return (
              <span key={way} className={wayClass}>
                <WayIcon weight="bold" className="size-3.5" />
                {way}
              </span>
            );
          })}
        </span>
      ),
    },
    { label: "file", content: <span className="text-mac-muted">skipnet · item file · clearance open</span> },
  ];
  const n = faces.length;
  const stepDeg = 360 / n;
  /** A face and a bevel meet at this angle, the drum's sides alternating wide and narrow */
  const bend = Math.PI / n;
  /** From the drum's axis to a bevel, then to a face, so each meets the next at its edges */
  const bevelApothem = (faceHeightPx / 2 + (bevelHeightPx / 2) * Math.cos(bend)) / Math.sin(bend);
  const apothem = bevelApothem * Math.cos(bend) + (bevelHeightPx / 2) * Math.sin(bend);

  const [turnDeg, setTurnDeg] = useState(0);
  /** Whilst dragged, its turn so far, drawn straight to the DOM rather than rendered */
  const drag = useRef<null | { y: number; from: number; deg: number }>(null);
  const [dragging, setDragging] = useState(false);
  const drumRef = useRef<HTMLDivElement>(null);
  /** The face shown, `0` the first, from any number of turns */
  const at = ((Math.round(turnDeg / stepDeg) % n) + n) % n;

  const drumTransformOf = (deg: number) => `translateZ(${-apothem}px) rotateX(${restTiltDeg + deg}deg)`;
  /** How far face `i` is turned from the front, in `[-180, 180)` */
  const offOf = (i: number, deg: number) => ((((i * stepDeg - deg) % 360) + 540) % 360) - 180;
  /** Its text fainter the further it faces away */
  const textOpacityOf = (i: number, deg: number) => Math.max(0, Math.cos((offOf(i, deg) * Math.PI) / 180)) ** 3;
  /** Draws the drum turned `deg`: its turn, its sides' fades. Its faces come first in it, then its bevels */
  const paint = (deg: number) => {
    const drum = drumRef.current;
    if (drum === null) return;
    drum.style.transform = drumTransformOf(deg);
    for (let i = 0; i < n; i++) {
      const face = drum.children[i] as HTMLElement;
      face.style.opacity = `${edgeFadeOf(offOf(i, deg))}`;
      (face.firstElementChild as HTMLElement).style.opacity = `${textOpacityOf(i, deg)}`;
      (drum.children[n + i] as HTMLElement).style.opacity = `${edgeFadeOf((i + 0.5) * stepDeg - deg)}`;
    }
  };
  /** A turn by state, e.g. a snap, eased by its transitions, which a drag's end has just restored */
  useLayoutEffect(() => paint(turnDeg), [turnDeg, dragging]);

  const snapTo = (deg: number) => setTurnDeg(Math.round(deg / stepDeg) * stepDeg);
  const step = (by: number) => snapTo(turnDeg + by * stepDeg);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    drag.current = { y: e.clientY, from: turnDeg, deg: turnDeg };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d === null) return;
    /** One face per face height dragged */
    d.deg = d.from - ((e.clientY - d.y) / faceHeightPx) * stepDeg;
    paint(d.deg);
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (d === null) return;
    drag.current = null;
    setDragging(false);
    snapTo(d.deg);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    step(e.key === "ArrowUp" ? -1 : 1);
  };

  return (
    <div
      tabIndex={0}
      title="drag up or down to turn it"
      className={cn(stageClass, dragging ? "cursor-grabbing" : "cursor-grab")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <div
        ref={drumRef}
        className={drumClass}
        style={{
          height: faceHeightPx,
          transform: drumTransformOf(turnDeg),
          transition: dragging ? "none" : undefined,
        }}
      >
        {faces.map((face, i) => (
          <div
            key={face.label}
            inert={i !== at}
            className={faceClass}
            style={{
              transform: `rotateX(${-i * stepDeg}deg) translateZ(${apothem}px)`,
              opacity: edgeFadeOf(offOf(i, turnDeg)),
              transition: dragging ? "none" : fadeTransition,
            }}
          >
            <span
              className={textClass}
              style={{ opacity: textOpacityOf(i, turnDeg), transition: dragging ? "none" : undefined }}
            >
              <span className={labelClass}>{face.label}</span>
              <span className="min-w-0">{face.content}</span>
            </span>
          </div>
        ))}
        {faces.map((face, i) => (
          <span
            key={face.label}
            aria-hidden
            className={bevelClass}
            style={{
              top: (faceHeightPx - bevelHeightPx) / 2 - seamPx,
              height: bevelHeightPx + 2 * seamPx,
              transform: `rotateX(${-(i + 0.5) * stepDeg}deg) translateZ(${bevelApothem}px)`,
              opacity: edgeFadeOf((i + 0.5) * stepDeg - turnDeg),
              transition: dragging ? "none" : fadeTransition,
            }}
          />
        ))}
      </div>
      <span className={navClass}>
        <button type="button" title="previous" className={navButtonClass} onClick={() => step(-1)}>
          <CaretUpIcon weight="bold" className="size-3" />
        </button>
        <span className="font-mono text-[9px] text-mac-muted">
          {at + 1}/{n}
        </span>
        <button type="button" title="next" className={navButtonClass} onClick={() => step(1)}>
          <CaretDownIcon weight="bold" className="size-3" />
        </button>
      </span>
    </div>
  );
}

/**
 * Fades a side out as it turns edge on, its tilt included, so it never flickers there.
 * `offDeg` is how far it is turned from the front.
 */
function edgeFadeOf(offDeg: number) {
  const facing = Math.cos(((offDeg - restTiltDeg) * Math.PI) / 180);
  const t = Math.max(0, Math.min(1, facing / edgeFadeFacing));
  return t * t * (3 - 2 * t);
}

/** Each way of activating an item has its icon, else a bolt */
const activationIcons: Record<string, Icon> = {
  code: TerminalWindowIcon,
  keys: KeyboardIcon,
  pointer: CursorClickIcon,
};

const faceHeightPx = 36;
/** The narrow blank sides between the faces */
const bevelHeightPx = 9;
/** How far each side overlaps the next, so no seam opens between them as it turns */
const seamPx = 1;
/** How square on a side must face to show fully, a cosine */
const edgeFadeFacing = 0.35;
const fadeTransition = "opacity 500ms ease-out";
/** Tilted at rest, so its top face shows */
const restTiltDeg = -14;

/** Room about it for the faces either side, in perspective */
const stageClass = tw(
  "not-prose relative mt-2 mb-5 pt-4 pb-6 px-3 pr-14 outline-none [perspective:800px] select-none touch-none focus-visible:ring-1 focus-visible:ring-mac-text/40",
);
/** A narrow blank side, a little darker than the faces */
const bevelClass = tw(
  "pointer-events-none absolute inset-x-0 border-x border-black bg-[color-mix(in_srgb,var(--color-mac-window),var(--color-mac-text)_16%)] [backface-visibility:hidden]",
);
/** One layer whilst it turns, so its sides are not re-rastered frame by frame */
const drumClass = tw(
  "relative [transform-style:preserve-3d] will-change-transform transition-transform duration-500 ease-out",
);
const faceClass = tw(
  "absolute inset-x-0 -inset-y-px flex items-center overflow-hidden border border-black bg-[color-mix(in_srgb,var(--color-mac-window),var(--color-mac-text)_7%)] px-3 font-mono text-[11px] text-mac-text [backface-visibility:hidden]",
);
const labelClass = tw("w-16 shrink-0 text-[8px] font-bold uppercase tracking-[0.2em] text-mac-muted");
/** Fainter the further it faces away, its face staying light */
const textClass = tw("flex min-w-0 items-center gap-4 transition-opacity duration-500");
const tagClass = tw("px-1.5 leading-5 border border-mac-text/30");
const wayClass = tw(
  "flex items-center gap-1 px-1.5 leading-5 border border-emerald-600/60 text-emerald-700 dark:border-emerald-400/50 dark:text-emerald-400 text-xs uppercase tracking-wider",
);
const navClass = tw("absolute right-0 top-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5");
const navButtonClass = tw(
  "grid size-5 place-items-center rounded-sm border border-mac-text/25 text-mac-muted cursor-pointer hover:text-mac-text",
);
