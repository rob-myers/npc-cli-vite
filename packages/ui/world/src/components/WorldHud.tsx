import { Menu } from "@base-ui/react/menu";
import { itemIconUrl } from "@npc-cli/media/icon";
import { cn, useStateRef } from "@npc-cli/util";
import {
  LockIcon,
  LockOpenIcon,
  PersonSimpleCircleIcon,
  PersonSimpleRunIcon,
  PersonSimpleWalkIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useContext, useEffect, useRef, useState } from "react";
import type { ItemKind } from "../const.env";
import { WorldContext } from "./world-context";

/**
 * The player's bar: look/follow and walk/run, then psi, their phaser, their keys and what they
 * carry — see `docs/inventory.md`. A slot is pressed, or its digit is. What they have is `w.e.carried`
 */
export default function WorldHud() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      menu: null,
      pressTimer: 0,
      longPressed: false,
      notice: null,
      noticeTimer: 0,

      selected: null,

      drop(name) {
        if (w.client === true) return;
        if (w.e.dropItem(w.player.key, name) === false) {
          return state.say("cannot drop here"); // a quad needs a table
        }
        if (state.selected === name) state.selected = null;
        state.update();
        w.view.forceUpdate();
      },
      say(notice) {
        window.clearTimeout(state.noticeTimer);
        state.noticeTimer = window.setTimeout(() => state.set({ notice: null }), noticeMs);
        state.set({ notice });
      },
      getItems() {
        return (w.e.carried[w.player.key]?.items ?? []).filter((def) => def.meta?.item !== "phaser");
      },
      getKeyDoor() {
        const { key } = w.player;
        const [held, doors, npc] = [w.e.npcToAccess[key] ?? {}, w.e.npcToDoors[key], w.n?.[key]];
        if (doors === undefined || npc === undefined) return null;
        if (doors.inside !== null && held[doors.inside] === true) return w.d[doors.inside] ?? null;
        let nearest: null | Geomorph.DoorState = null;
        let nearestDist = Infinity;
        for (const gdKey of doors.nearby) {
          const door = w.d[gdKey];
          if (held[gdKey] !== true || door === undefined || door.sealed === true) continue;
          const dist = npc.distanceTo({ x: (door.src.x + door.dst.x) / 2, y: (door.src.y + door.dst.y) / 2 });
          if (dist < nearestDist) [nearest, nearestDist] = [door, dist];
        }
        return nearest;
      },
      press(index) {
        if (w.client === true) return;
        if (index === 0) w.player.togglePsi();
        else if (index === 1) w.player.toggleArm();
        else if (index === 2) {
          const door = state.getKeyDoor();
          if (door !== null) w.e.toggleLock(door.gdKey, { access: true });
        } else {
          const def = state.getItems()[index - 3];
          if (def === undefined) return;
          state.selected = state.selected === def.key ? null : def.key;
        }
        state.update();
        w.view.forceUpdate();
      },
    }),
  );

  w.hud = state;

  useEffect(() => {
    const sub = w.events.subscribe({
      next(e) {
        if (rerenderOn.has(e.key) === false) return;
        if ("npcKey" in e && e.npcKey !== w.player.key) return;
        state.update();
      },
    });
    return () => sub.unsubscribe();
  }, []);

  // neither psi nor phasers are mirrored
  if (w.client === true)
    return (
      <div className={barClass}>
        <div className={rowClass}>
          <PlayerButtons />
        </div>
      </div>
    );

  const { key: playerKey } = w.player;
  const big = w.touchDevice;

  const heldDoors = w.e.getHeldDoors(playerKey) ?? [];
  const keyCount = heldDoors.length;
  const keyDoor = state.getKeyDoor();
  const KeyLock = keyDoor?.locked === true ? LockIcon : LockOpenIcon;
  const psiOn = (w.psi?.getTarget() ?? null) !== null;
  const hasPhaser = w.e.hasItem(playerKey, "phaser");
  const armed = w.phasers?.isArmed(playerKey) === true;
  const dead = w.shields?.isDead(playerKey) === true;

  /** By slot, what a right-click on it offers */
  const menus: Record<number, undefined | SlotMenuItem[]> = {};

  const slot = (index: number, opts: SlotOpts, children: React.ReactNode) => {
    menus[index] = opts.menu;
    return (
      <div
        key={index}
        title={opts.hotkey === undefined ? opts.title : `${opts.title}: ${opts.hotkey}`}
        className={cn(
          "group relative grid shrink-0 cursor-pointer touch-pan-x place-items-center rounded-md",
          opts.plain !== true && "hover:ring-1 hover:ring-yellow-200/25",
          big ? "h-12" : "h-18",
          opts.narrow === true ? (big ? "w-9" : "w-13") : big ? "w-12" : "w-18",
          opts.active === true && opts.plain !== true && "bg-yellow-200/10 ring-1 ring-yellow-200/25",
          opts.had === false && "*:opacity-25",
        )}
        // the canvas keeps the focus: Enter there unpauses, and would press this again too
        onMouseDown={(e) => e.preventDefault()}
        onContextMenu={(e) => {
          e.preventDefault();
          if (opts.menu?.length) state.set({ menu: { index, el: e.currentTarget } });
        }}
        // touch has no right-click: a hold opens the menu, and a scroll of the row calls it off
        onPointerDown={(e) => {
          state.longPressed = false;
          if (e.pointerType !== "touch" || !opts.menu?.length) return;
          const el = e.currentTarget;
          window.clearTimeout(state.pressTimer);
          state.pressTimer = window.setTimeout(() => {
            state.longPressed = true;
            state.set({ menu: { index, el } });
          }, longPressMs);
        }}
        onPointerUp={() => window.clearTimeout(state.pressTimer)}
        onPointerCancel={() => window.clearTimeout(state.pressTimer)}
        onPointerLeave={() => window.clearTimeout(state.pressTimer)}
        onClick={() => {
          if (state.longPressed === true) return; // the hold was the press
          state.press(index);
          w.view.focus();
        }}
      >
        {children}
        {opts.drop !== undefined && (
          <button
            type="button"
            tabIndex={-1}
            title={`drop ${opts.title}`}
            className={cn(
              "absolute top-0.5 right-0.5 cursor-pointer place-items-center rounded-full border border-sky-300/50 bg-sky-950 text-sky-100 opacity-100! hover:border-red-400/70 hover:text-red-300",
              big ? "size-6" : "size-5",
              opts.active === true && opts.plain !== true ? "grid" : "hidden group-hover:grid",
            )}
            onClick={(e) => {
              e.stopPropagation();
              state.drop(opts.drop as string);
              w.view.focus();
            }}
          >
            <XIcon className="size-3" weight="bold" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className={barClass}>
      {/* out here, not in the row: it scrolls, so would clip it */}
      {state.notice !== null && (
        <div className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-neutral-900/90 px-2 py-0.5 text-xs text-amber-200">
          {state.notice}
        </div>
      )}
      <div className={rowClass}>
        <PlayerButtons />
        {/* what they are, apart from what they carry: no gap, as each icon's own margin is one */}
        <div className={cn("mr-1 flex shrink-0 rounded-md", big ? "px-2.5" : "px-3.5")}>
          {slot(
            0,
            { title: "psi", hotkey: "q", had: w.e.hasItem(playerKey, "psi"), active: psiOn, plain: true },
            <BrainIcon firing={psiOn} paused={w.disabled} />,
          )}
          {slot(
            1,
            {
              title: dead ? "phaser (deactivated)" : "phaser",
              hotkey: "e",
              had: hasPhaser,
              active: armed,
              plain: true,
              drop: hasPhaser ? "phaser" : undefined,
              // dropped without drawing it first
              menu: hasPhaser ? [{ label: "drop", run: () => state.drop("phaser") }] : undefined,
            },
            <PhaserIcon armed={armed} locked={w.phasers?.isLocked(playerKey) === true} dead={dead} />,
          )}
          {slot(
            2,
            {
              title: keyDoor === null ? "keys" : `key to ${keyDoor.gdKey}`,
              had: keyCount > 0,
              active: keyDoor !== null,
              plain: true,
              menu: heldDoors.map((gdKey) => ({
                label: `split ${gdKey}`,
                run: () => w.e.unchainKey(playerKey, gdKey),
              })),
            },
            <>
              <ItemIcon kind="keychain" />
              {keyCount > 0 && (
                <span className="absolute right-1 bottom-0.5 text-xs leading-3 text-sky-100">{keyCount}</span>
              )}
              {keyDoor !== null && (
                <KeyLock className="absolute top-0.5 right-0.5 size-4 text-amber-300" weight="fill" />
              )}
            </>,
          )}
        </div>
        {state.getItems().map((def, i) =>
          slot(
            i + 3,
            {
              title: [def.meta?.label ?? def.meta?.item, def.meta?.door].filter(Boolean).join(" "),
              had: true,
              narrow: true,
              active: state.selected === def.key,
              drop: def.key,
              // a keycard for a door joins the keys
              menu: [
                ...(def.meta?.door ? [{ label: "add to keychain", run: () => w.e.chainKey(playerKey, def.key) }] : []),
                { label: "drop", run: () => state.drop(def.key) },
              ],
            },
            <>
              <ItemIcon kind={def.meta?.item} />
              {def.meta?.door && (
                <span className="absolute right-1 bottom-0.5 text-[10px] leading-3 text-sky-100 [text-shadow:0_0_3px_#000,0_0_3px_#000]">
                  {def.meta.door}
                </span>
              )}
            </>,
          ),
        )}
      </div>

      <Menu.Root open={state.menu !== null} onOpenChange={(open) => open || state.set({ menu: null })} modal={false}>
        <Menu.Portal container={w.rootEl}>
          <Menu.Positioner anchor={state.menu?.el} side="top" sideOffset={6} className="z-50">
            <Menu.Popup className="pointer-events-auto max-h-48 select-none overflow-y-auto rounded-md border border-neutral-700 bg-neutral-800/90 py-1 text-xs shadow-lg">
              {menus[state.menu?.index ?? -1]?.map(({ label, run }) => (
                <Menu.Item
                  key={label}
                  className={cn(
                    "cursor-pointer px-3 py-1 text-neutral-300 hover:bg-neutral-700",
                    big && "py-2 text-sm",
                  )}
                  onClick={() => {
                    run();
                    w.view.focus();
                  }}
                >
                  {label}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

/** The player themself, ahead of the slots: where the camera stands by them, and how they go */
function PlayerButtons() {
  const w = useContext(WorldContext);
  const press = useRef({ timer: 0, long: false });
  const { follow } = w.view;
  const followFlash = useChangeCount(follow);
  const big = w.touchDevice;
  const hurry = w.n?.[w.player.key]?.anim.hurry === true;
  const GaitIcon = hurry ? PersonSimpleRunIcon : PersonSimpleWalkIcon;
  const buttonClass = cn(
    "relative grid shrink-0 cursor-pointer touch-none place-items-center overflow-hidden rounded-md hover:ring-1 hover:ring-yellow-200/25",
    big ? "size-12" : "size-9",
  );
  const buttonIcon = (lit: boolean) =>
    cn("relative drop-shadow-[0_1px_3px_rgb(0_0_0/0.9)]", lit ? "text-amber-300" : "text-neutral-200");

  const endPress = (cancelled: boolean) => {
    window.clearTimeout(press.current.timer);
    if (cancelled === false && press.current.long === false) w.view.onLookGesture(false);
  };

  return (
    <div
      className={cn(
        "mr-1 flex shrink-0 self-center rounded-md border border-neutral-400/25 bg-neutral-900/60",
        big ? "flex-row" : "flex-col",
      )}
      // the canvas keeps the focus
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* a client's moves are not theirs to pace */}
      {w.client !== true && (
        <div className={buttonClass} title={`${hurry ? "run" : "walk"}: f`} onClick={() => w.player.toggleRun()}>
          <GaitIcon className={cn(buttonIcon(hurry), "size-5")} weight="bold" />
        </div>
      )}
      {/* a press looks at the player, or stops a follow (amber); a long press toggles it — as `c` */}
      <div
        className={buttonClass}
        title={`follow ${follow ? "on" : "off"}: c`}
        onPointerDown={() => {
          press.current.long = false;
          press.current.timer = window.setTimeout(() => {
            press.current.long = true;
            w.view.onLookGesture(true);
          }, longPressMs);
        }}
        onPointerUp={() => endPress(false)}
        onPointerLeave={() => endPress(true)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <AnimatePresence>
          {w.view.lookingAt === true && (
            // pulses whilst a pan is under way, which a black screen or a paused world would hide
            <motion.div
              className="pointer-events-none absolute inset-0 bg-white/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0, transition: { duration: lookingAtFadeMs / 1000, ease: "easeOut" } }}
              transition={{ duration: lookingAtPulseMs / 1000, repeat: Infinity, repeatType: "reverse" }}
            />
          )}
        </AnimatePresence>
        {followFlash > 0 && (
          // keyed by the count, so each toggle replays the fade
          <motion.div
            key={followFlash}
            className={cn("pointer-events-none absolute inset-0", follow ? "bg-amber-300" : "bg-neutral-400")}
            initial={{ opacity: 0.55 }}
            animate={{ opacity: 0 }}
            transition={{ duration: followFlashMs / 1000, ease: "easeOut" }}
          />
        )}
        <PersonSimpleCircleIcon className={cn(buttonIcon(follow), "size-6")} />
      </div>
    </div>
  );
}

/** How many times `value` has changed since mount — `0` until the first, so nothing flashes on load */
function useChangeCount(value: unknown): number {
  const [count, setCount] = useState(0);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setCount((x) => x + 1);
  }, [value]);

  return count;
}

/** Holds an svg's animations where they are whilst `paused`, as the World is */
function useSvgPause(paused: boolean) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    paused ? ref.current?.pauseAnimations() : ref.current?.unpauseAnimations();
  });
  return ref;
}

const barClass = "@container pointer-events-none absolute inset-x-0 bottom-6 z-10 flex select-none px-2";
/** Scrolled sideways once it outgrows a narrow World; padded, else the scroll clips a slot's ring */
const rowClass = "pointer-events-auto mx-auto flex max-w-full overflow-x-auto p-1 [scrollbar-width:none]";

/** Each icon's size, as a fraction of its slot's height: what they merely carry is drawn smaller */
const iconScale: Record<"psi" | "keychain" | ItemKind, number> = {
  psi: 0.85,
  phaser: 0.85,
  keychain: 0.85,
  book: 0.65,
  box: 0.65,
  /** It fills its square, so reads larger than the rest */
  keycard: 0.53,
};
const iconStyle = (kind: keyof typeof iconScale) => ({ height: `${iconScale[kind] * 100}%` });

/** The shadow is each icon's own: on a slot it would be redrawn with every frame of the brain */
const iconShadow = "drop-shadow-[0_1px_3px_rgb(0_0_0/0.9)]";
const iconClass = cn("aspect-square", iconShadow);

const ItemIcon = memo(function ItemIcon({ kind }: { kind: ItemKind | "keychain" }) {
  return (
    <img
      className={cn(iconClass, "object-contain")}
      style={iconStyle(kind)}
      src={itemIconUrl[kind]}
      alt={kind}
      draggable={false}
    />
  );
});

/**
 * The gun `Phasers` draws, its boxes turned a little towards us — and whilst `locked`, its beam.
 * Generated: `shaderConfig.gunBoxes` projected at azimuth -38°, elevation 28°
 */
const PhaserIcon = memo(function PhaserIcon({
  armed,
  locked,
  dead,
}: {
  armed: boolean;
  locked: boolean;
  dead: boolean;
}) {
  return (
    <svg className={iconClass} style={iconStyle("phaser")} viewBox="0 0 64 64" aria-label="phaser">
      <defs>
        <radialGradient id="hud-phaser-glow">
          <stop offset="0" stopColor="#ff8a5c" stopOpacity="0.8" />
          <stop offset="1" stopColor="#ff8a5c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hud-phaser-beam" gradientUnits="userSpaceOnUse" x1="44.4" y1="32.5" x2="56" y2="36.7">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="hud-phaser-fade">
          <rect x="40" y="26" width="20" height="16" fill="url(#hud-phaser-beam)" />
        </mask>
      </defs>
      {/* the gun centred, whatever it is doing */}
      <g transform="translate(8)">
        <g stroke="#2b3038" strokeWidth="0.5" strokeLinejoin="round">
          {phaserFaces.map(([face, d]) => (
            // holstered, its emitter is as dull as the rest
            <path key={d} d={d} fill={phaserFill[armed ? face : dead ? phaserDead[face] : phaserOff[face]]} />
          ))}
        </g>
        {armed === true && <circle cx="41" cy="31.3" r="9" fill="url(#hud-phaser-glow)" />}
        {/* its beam fades in, and out towards the edge rather than ending in a dot */}
        <g
          mask="url(#hud-phaser-fade)"
          className={cn("transition-opacity duration-300", locked ? "opacity-100" : "opacity-0")}
        >
          <path d="M44.4 32.5 56 36.7" stroke="#ff8a5c" strokeOpacity="0.45" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M44.4 32.5 56 36.7" stroke="#ffd2bf" strokeWidth="1" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );
});

/** Lit from above, as the gun is: its top, the side towards us, the end it fires from */
const phaserFill = {
  top: "#8f98a5",
  side: "#6c7582",
  end: "#505863",
  glowTop: "#ffa784",
  glowSide: "#ff8a5c",
  glowEnd: "#d9744d",
  deadTop: "#6ea4ee",
  deadSide: "#3d7fd9",
  deadEnd: "#2f63ab",
};

/** Each face as it is with the gun put away */
const phaserOff = { top: "top", side: "side", end: "end", glowTop: "top", glowSide: "side", glowEnd: "end" } as const;

// biome-ignore format: a row
const phaserDead = { top: "top", side: "side", end: "end", glowTop: "deadTop", glowSide: "deadSide", glowEnd: "deadEnd" } as const;

const phaserFaces: [keyof typeof phaserOff, string][] = [
  ["top", "M14.5 24.0 23.5 27.3 18.2 30.4 9.2 27.2Z"],
  ["side", "M9.2 49.8 18.2 53.1 18.2 30.4 9.2 27.2Z"],
  ["end", "M23.5 49.9 18.2 53.1 18.2 30.4 23.5 27.3Z"],
  ["top", "M12.0 10.9 41.2 21.6 34.2 25.8 5.0 15.1Z"],
  ["side", "M5.0 27.7 34.2 38.4 34.2 25.8 5.0 15.1Z"],
  ["end", "M41.2 34.2 34.2 38.4 34.2 25.8 41.2 21.6Z"],
  ["glowTop", "M39.9 24.9 46.6 27.4 42.2 30.0 35.5 27.6Z"],
  ["glowSide", "M35.5 35.1 42.2 37.6 42.2 30.0 35.5 27.6Z"],
  ["glowEnd", "M46.6 34.9 42.2 37.6 42.2 30.0 46.6 27.4Z"],
];

/**
 * A brain seen from its left: a see-through solid, its neurons `firing` whilst psi is on.
 * Still otherwise: an animation keeps the page painting, paused World or not
 */
const BrainIcon = memo(function BrainIcon({ firing, paused }: { firing: boolean; paused: boolean }) {
  return (
    <svg
      ref={useSvgPause(paused)}
      className={firing && paused === false ? "aspect-square" : iconClass}
      style={iconStyle("psi")}
      viewBox="0 0 64 64"
      aria-label="psi"
    >
      <defs>
        <radialGradient id="hud-brain" cx="0.36" cy="0.26" r="0.85">
          <stop offset="0" stopColor="#f2f3f5" />
          <stop offset="0.45" stopColor="#a9adb5" />
          <stop offset="1" stopColor="#4d515a" />
        </radialGradient>
        <radialGradient id="hud-brain-far" cx="0.4" cy="0.2" r="0.9">
          <stop offset="0" stopColor="#8d9199" />
          <stop offset="1" stopColor="#3c4048" />
        </radialGradient>
        <radialGradient id="hud-neuron">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.4" stopColor="#9fe3ff" />
          <stop offset="1" stopColor="#9fe3ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* stem, cerebellum, then the far hemisphere showing over the near one */}
      <g opacity={0.45}>
        <path d="M33 42c1 6 2 11 5 16h7c-3-5-4-10-4-16z" fill="url(#hud-brain-far)" />
        <ellipse cx="47" cy="45" rx="10" ry="6.5" fill="url(#hud-brain-far)" />
        <path d="M11 30C10 16 22 6 35 6c14 0 25 9 24 23-1 9-7 13-13 13" fill="url(#hud-brain-far)" />
        <path
          d="M7 34C5 21 16 10 31 10c15-1 27 9 26 23-1 8-7 12-14 12-4 2-9 1-13 0-7 2-20 1-23-11z"
          fill="url(#hud-brain)"
          stroke="#d9dde3"
          strokeOpacity="0.9"
          strokeWidth="0.9"
        />
      </g>
      <path
        d="M41 43c4-2 9-2 14 0M40 46.5c5-2 11-2 16 0M12 32c5-3 9-1 12-5s8-3 10-8M20 41c3-4 8-3 11-7s9-3 13-7M17 20c4 1 6-3 10-2s5-4 9-4M33 44c2-4 7-4 10-8s7-3 10-7M41 14c2 3 6 3 8 7s5 4 6 8M24 13c2 3 6 2 8 5M9 26c3 0 4-3 7-3"
        fill="none"
        stroke="#e6e9ee"
        strokeOpacity="0.35"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      {/* axons, a pulse running down each in turn */}
      {firing === true &&
        brainAxons.map(([d, begin], i) => (
          <path key={i} d={d} pathLength={1} {...brainAxon}>
            <animate
              attributeName="stroke-dashoffset"
              values="0.3;-1"
              dur="2.4s"
              begin={`${begin}s`}
              repeatCount="indefinite"
            />
          </path>
        ))}
      {brainNeurons.map(([cx, cy, begin], i) => (
        <circle key={i} cx={cx} cy={cy} r="3.2" fill="url(#hud-neuron)" opacity="0.15">
          {firing === true && (
            <animate
              attributeName="opacity"
              values="0.15;1;0.15;0.15"
              keyTimes="0;0.12;0.4;1"
              dur="2.4s"
              begin={`${begin}s`}
              repeatCount="indefinite"
            />
          )}
        </circle>
      ))}
    </svg>
  );
});

const brainAxon = {
  fill: "none",
  stroke: "#9fe3ff",
  strokeWidth: 1.1,
  strokeLinecap: "round",
  strokeDasharray: "0.3 1",
  strokeDashoffset: 0.3,
} as const;

/** `[path, seconds in]`, each from one of `brainNeurons` to the next */
const brainAxons: [string, number][] = [
  ["M14 30Q20 22 27 21", 0],
  ["M27 21Q35 15 44 19", 0.5],
  ["M44 19Q52 24 50 33", 1],
  ["M27 21Q30 30 37 34", 0.6],
  ["M37 34Q44 38 50 33", 1.2],
  ["M14 30Q20 38 28 39", 1.5],
  ["M28 39Q33 38 37 34", 2],
];

/** `[x, y, seconds in]`, lit as a pulse sets out or lands */
const brainNeurons: [number, number, number][] = [
  [14, 30, 0],
  [27, 21, 0.5],
  [44, 19, 1],
  [50, 33, 1.5],
  [37, 34, 1.2],
  [28, 39, 2],
];

/** Events which may change what a slot shows — those of an npc, only the player's */
const rerenderOn = new Set<JshCli.Event["key"]>([
  "disabled",
  "enabled",
  "set-player",
  "spawned",
  "removed-npcs",
  "npcs-restored",
  "net-changed",
  "enter-collider",
  "exit-collider",
  "door-locked",
  "door-unlocked",
]);

/** How long a touch is held before a slot's menu opens, or the look button before it toggles the follow */
const longPressMs = 500;
/** How long the look button's flash takes to fade, when follow is turned on or off */
const followFlashMs = 550;
/** Half a pulse of the look button, whilst a pan is under way */
const lookingAtPulseMs = 700;
/** How long the pulse takes to fade once the pan lands */
const lookingAtFadeMs = 400;

/** How long the bar's notice shows */
const noticeMs = 1500;

type SlotMenuItem = { label: string; run(): void };

type SlotOpts = {
  title: string;
  /** The key that presses it, after its name in the tooltip */
  hotkey?: string;
  had: boolean;
  active: boolean;
  /** What its "x" puts down, shown on hover — and whilst `active`, unless `plain` */
  drop?: string;
  /** Neither hover nor `active` tints it: its icon says it is on */
  plain?: true;
  /** What a right-click on it offers */
  menu?: SlotMenuItem[];
  /** A carried item's: they sit closer together */
  narrow?: true;
};

export type State = {
  /** The slot whose right-click menu shows, hung off its element */
  menu: null | { index: number; el: HTMLElement };
  pressTimer: number;
  /** The touch now ending opened the menu, so is no press */
  longPressed: boolean;
  /** The key of the carried item a press chose, a second press letting it go */
  selected: null | string;
  /** Puts an item of the player's at their feet: the slot's "x" */
  drop(name: string): void;
  /** What the bar says above itself, a moment: something of theirs was refused */
  notice: null | string;
  noticeTimer: number;
  say(notice: string): void;
  /** What they carry, in slot order — their phaser has a slot of its own */
  getItems(): Geomorph.DecorDef[];
  /** The door at hand that the player holds the key to */
  getKeyDoor(): null | Geomorph.DoorState;
  /** As a click on that slot, from `0`: psi, phaser, keys, then items */
  press(index: number): void;
};
