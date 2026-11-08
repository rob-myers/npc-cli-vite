import { Menu } from "@base-ui/react/menu";
import { itemIconUrl } from "@npc-cli/media/icon";
import { cn, useStateRef } from "@npc-cli/util";
import { ListIcon, UserFocusIcon, XIcon } from "@phosphor-icons/react";
import "./world-hud.css";
import { AnimatePresence, type MotionValue, motion, useDragControls, useMotionValue } from "motion/react";
import { memo, useContext, useEffect, useRef, useState } from "react";
import type { ItemKind } from "../const.env";
import { getWorldStore, type HudLayout } from "../service/storage";
import { WorldContext } from "./world-context";

/**
 * The player's bar: psi, their phaser, their keys and what they carry, then follow, the compass
 * and an options menu — see `docs/inventory.md`. A slot is pressed, or its digit is. What they have is `w.e.carried`
 */
export default function WorldHud() {
  const w = useContext(WorldContext);
  const store = getWorldStore(w.key);

  const dragControls = useDragControls();
  const state = useStateRef(
    (): State => ({
      barEl: null,
      colEl: null,
      compassEl: null,
      dragged: false,
      itemsEl: null,
      menu: null,
      pressTimer: 0,
      longPressed: false,
      notice: null,
      noticeTimer: 0,

      selected: null,
      y: null as any,

      drop(name) {
        if (w.client === true) return;
        if (w.e.dropItem(w.player.key, name) === false) {
          return state.say("cannot drop here"); // a quad needs a table
        }
        if (state.selected === name) state.selected = null;
        state.update();
        w.view.forceUpdate();
      },
      fitColumns() {
        const { colEl, itemsEl } = state;
        const rootH = w.rootEl?.clientHeight ?? 0;
        if (state.isColumn() === false || colEl === null || itemsEl === null || rootH === 0) return;
        // the slots scroll once the column would not fit, below the menu's on the left
        const menuH = state.getLayout() === "left" ? (w.menu.colEl?.offsetHeight ?? 0) + columnGap : 0;
        const restH = colEl.offsetHeight - itemsEl.offsetHeight + menuH;
        itemsEl.style.maxHeight = `${Math.max(columnSlotHeight, rootH - (w.menu.minY ?? 0) - columnGap - restH)}px`;
        itemsEl.style.touchAction = itemsEl.scrollHeight > itemsEl.clientHeight ? "pan-y" : "none";
        state.makeWay("menu");
      },
      getDragBounds() {
        const rootH = w.rootEl?.clientHeight ?? 0;
        if (state.isColumn() === false) return { top: Math.min(0, noticesHeight + hudBarHeight - rootH), bottom: 0 };
        const top = w.menu.minY ?? 0;
        return { top, bottom: Math.max(top, rootH - (state.colEl?.offsetHeight ?? 0) - columnGap) };
      },
      getItems() {
        return (w.e.carried[w.player.key]?.items ?? []).filter((def) => def.meta?.item !== "phaser");
      },
      getKept() {
        const { key } = w.player;
        /** Sat or lain they never strafe, aiming or not */
        const stood = w.player.get()?.posture === "stand";
        const kept: Kept[] = [];
        const armed = w.phasers?.isArmed(key) === true;
        if (armed) {
          kept.push({ label: "aim", title: "lower phaser: e", end: () => w.phasers?.disarm(key) });
          if (stood) kept.push({ label: "strafe", title: "strafing whilst aiming" });
        } else if (w.player.strafe && stood)
          kept.push({ label: "strafe", title: "stop strafing: shift twice", end: () => w.player.toggleStrafe() });
        // focus mode, or a cap on their frontier whilst the follow frames them. Shown and labelled by `watchLook`.
        // Raised, the red dot is the look instead: see `watchAim`
        if (!armed && (w.player.focus || (w.view?.follow === true && w.view.cameraMode === "embodied")))
          kept.push({ label: "look", title: "stop looking: r", end: () => w.player.stopLooking() });
        if (w.view?.follow === true)
          kept.push({ label: "follow", title: "stop following: v", end: () => w.view.setFollow(false) });
        if (w.gameTime.scale !== 1)
          kept.push({
            label: `time ${Number(w.gameTime.scale.toFixed(2))}`,
            title: "back to time 1: [ and ] step it",
            end: () => w.gameTime.setScale(1),
          });
        return kept;
      },
      getLayout() {
        return w.debug?.hudLayout ?? store.read().hudLayout;
      },
      getSavedY() {
        const saved = store.read();
        if (state.isColumn()) return saved.hudColumnY ?? defaultColumnY;
        return Math.max(state.getDragBounds().top, saved.hudY ?? 0);
      },
      isColumn() {
        return state.getLayout() !== "bar";
      },
      makeWay(moved) {
        const { colEl: menuEl, colY: menuY, minY } = w.menu;
        const rootH = w.rootEl?.clientHeight ?? 0;
        if (state.getLayout() !== "left" || state.colEl === null || !menuEl || rootH === 0) return;
        const hud = { y: state.y, h: state.colEl.offsetHeight };
        const menu = { y: menuY, h: menuEl.offsetHeight };
        const [a, b] = moved === "hud" ? [hud, menu] : [menu, hud];
        const [at, bt] = [a.y.get(), b.y.get()];
        if (at + a.h + columnGap <= bt || bt + b.h + columnGap <= at) return;
        // pushed along, else hopped over
        const below = at + a.h + columnGap;
        const above = at - columnGap - b.h;
        const fitsBelow = below + b.h <= rootH - columnGap;
        const fitsAbove = above >= minY;
        if (fitsBelow && (bt + b.h / 2 >= at + a.h / 2 || fitsAbove === false)) b.y.set(below);
        else if (fitsAbove) b.y.set(above);
      },
      persistY() {
        store.patch(state.isColumn() ? { hudColumnY: state.y.get() } : { hudY: state.y.get() });
      },
      press(index) {
        if (w.client === true) return;
        if (index === 0) w.player.togglePsi();
        else if (index === 1) w.player.toggleArm();
        else if (index > 2) {
          const def = state.getItems()[index - 3];
          if (def === undefined) return;
          state.selected = state.selected === def.key ? null : def.key;
        }
        state.update();
        w.view.forceUpdate();
      },
      say(notice) {
        window.clearTimeout(state.noticeTimer);
        state.noticeTimer = window.setTimeout(() => state.set({ notice: null }), noticeMs);
        state.set({ notice });
      },
      syncCompass() {
        const { compassEl: el } = state;
        if (el === null || w.view === undefined) return;
        const { compassPoint, wasdSkew, wasdSnapped } = w.view;
        const letter = compassLetters[compassPoint];
        el.toggleAttribute("data-snapped", wasdSnapped);
        el.querySelector("title")?.replaceChildren(`w heads ${wasdSnapped ? "" : "near "}${letter}`);
        el.querySelector("text")?.replaceChildren(letter);
        el.querySelector("path")?.setAttribute("transform", `rotate(${(wasdSkew * 180) / Math.PI})`);
      },
      watchAim(el) {
        if (el === null || w.r3f == null) return;
        const reachEl = el.querySelector<HTMLElement>("[data-aim-reach]");
        return w.e.addFrameCallback(() => {
          el.classList.toggle("blocked", w.phasers?.isDrawnIn(w.player.key) === true);
          setReadout(reachEl, w.npcFocus?.reachOf(w.player.key) ?? null); // the red dot's range
        });
      },
      watchLook(el) {
        if (el === null || w.r3f == null) return;
        const wordEl = el.querySelector("[data-look-word]");
        const reachEl = el.querySelector<HTMLElement>("[data-look-reach]");
        return w.e.addFrameCallback(() => {
          const { focus, lookCap } = w.player;
          const framed = w.view.follow === true && w.view.cameraMode === "embodied";
          const cap = framed ? lookCap : null;
          el.style.setProperty("display", focus || cap !== null ? "" : "none");
          el.classList.toggle("blocked", focus && w.player.isFocusYielding());
          const word = focus ? "focus" : "look"; // focus mode, else a look's cap alone
          if (wordEl && wordEl.textContent !== word) wordEl.textContent = word;
          setReadout(reachEl, cap?.reach ?? null);
        });
      },
    }),
  );

  w.hud = state;

  /** The bar along the bottom, or a column on either side: by default on the right on touch */
  const layout = state.getLayout();
  const column = layout !== "bar";
  const outerClass = column ? cn(columnBarClass, layout === "left" ? "left-0" : "right-0") : barClass;

  state.y = useMotionValue(state.getSavedY());
  /** Dragged up and down by any part of it, as the menu is: a slot pressed is then no press */
  const dragProps = {
    ref: (el: null | HTMLDivElement) => void (state.colEl = el),
    style: { y: state.y },
    drag: "y",
    dragListener: false,
    dragControls,
    dragConstraints: state.getDragBounds(),
    dragMomentum: false,
    dragElastic: 0,
    onPointerDown(e: React.PointerEvent) {
      // an overflowing column's slots scroll instead
      if (state.itemsEl?.style.touchAction === "pan-y" && state.itemsEl.contains(e.target as Node)) return;
      dragControls.start(e);
    },
    onDrag: () => state.makeWay("hud"),
    onDragStart: () => void (state.dragged = true),
    onDragEnd() {
      state.persistY();
      if (layout === "left") w.menu.persistY?.();
      requestAnimationFrame(() => (state.dragged = false));
    },
  } as const;

  /** Rerenders on the player's events. The camera zooms by a wheel or pinch over the bar, as over the World */
  useEffect(() => {
    const sub = w.events.subscribe({
      next(e) {
        if (rerenderOn.has(e.key) === false) return;
        if ("npcKey" in e && e.npcKey !== w.player.key) return;
        state.update();
      },
    });
    /** Fingers down on the bar, handed to the camera once they pinch */
    const touches = new Map<number, PointerEvent>();
    const onTouchEnd = (e: PointerEvent) => void touches.delete(e.pointerId);
    const ctrl = new AbortController();
    const { signal } = ctrl;
    state.barEl?.addEventListener(
      "wheel",
      (e) => {
        // a sideways scroll is the row's own, unless it is a trackpad pinch
        if (e.ctrlKey === true || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) w.view.controls?.onMouseWheel(e);
      },
      { passive: false, signal },
    );
    state.barEl?.addEventListener(
      "pointerdown",
      (e) => {
        const { controls } = w.view;
        if (e.pointerType !== "touch" || controls === null) return;
        touches.set(e.pointerId, e);
        if (touches.size + controls.pointers.length < 2) return;
        // a second finger: no slot press nor drag of the bar
        window.clearTimeout(state.pressTimer);
        dragControls.cancel();
        for (const t of touches.values()) if (controls.pointerIndex(t) === -1) controls.onPointerDown(t);
      },
      { signal },
    );
    document.addEventListener("pointerup", onTouchEnd, { signal });
    document.addEventListener("pointercancel", onTouchEnd, { signal });
    return () => {
      sub.unsubscribe();
      ctrl.abort();
    };
  }, []);

  /** The column makes way for the menu's as either grows */
  useEffect(() => {
    state.y.set(state.getSavedY());
    if (column === false) {
      state.itemsEl?.style.removeProperty("max-height");
      state.itemsEl?.style.removeProperty("touch-action");
      return;
    }
    const observer = new ResizeObserver(() => state.fitColumns());
    for (const el of [state.colEl, w.rootEl]) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [layout]);

  // neither psi nor phasers are mirrored
  if (w.client === true)
    return (
      <div ref={(el) => void (state.barEl = el)} className={outerClass}>
        <motion.div className={column ? columnClass : rowClass} {...dragProps}>
          <PlayerButtons column={column} />
        </motion.div>
      </div>
    );

  const { key: playerKey } = w.player;
  const big = w.touchDevice;

  const heldDoors = w.e.getHeldDoors(playerKey) ?? [];
  const keyCount = heldDoors.length;
  const psiOn = w.e.isPsiRaised();
  const hasPhaser = w.e.hasItem(playerKey, "phaser");
  const armed = w.phasers?.isArmed(playerKey) === true;
  /** None before the canvas: their refs watch it each frame */
  const kept = w.threeReady === true ? state.getKept() : [];
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
          "group pointer-events-auto relative grid shrink-0 cursor-pointer place-items-center rounded-md",
          column === false && "touch-pan-x",
          opts.plain !== true && "hover:ring-1 hover:ring-yellow-200/25",
          // a column's slots are shorter, its icons as big as the bar's
          big
            ? column
              ? "h-12 w-12.5 [--hud-icon-base:60px]"
              : "h-15 w-12.5"
            : column
              ? "h-15 w-15 [--hud-icon-base:72px]"
              : "h-18 w-15",
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
            if (state.dragged === true) return;
            state.longPressed = true;
            state.set({ menu: { index, el } });
          }, longPressMs);
        }}
        onPointerUp={() => window.clearTimeout(state.pressTimer)}
        onPointerCancel={() => window.clearTimeout(state.pressTimer)}
        onPointerLeave={() => window.clearTimeout(state.pressTimer)}
        onClick={() => {
          if (state.longPressed === true || state.dragged === true) return; // the hold was the press, or a drag
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
              big ? "size-7" : "size-5",
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
    <>
      {/* at the World's top, clear of the bar wherever it is dragged */}
      {(state.notice !== null || kept.length > 0) && (
        <div className={noticesClass}>
          {/* kept whilst aiming, strafing, looking, following, capped or off time 1, an "x" ending one that may be ended */}
          {kept.length > 0 && (
            <div className="flex items-center gap-1">
              {kept.map(({ label, title, end }) => (
                <div
                  key={label}
                  ref={label === "aim" ? state.watchAim : label === "look" ? state.watchLook : undefined}
                  title={end === undefined ? title : undefined}
                  className={cn(
                    "group pointer-events-auto flex items-center gap-1 rounded bg-neutral-900/90 py-0.5 [&.blocked]:text-neutral-400",
                    end === undefined ? "px-2" : "pr-0.5 pl-2",
                  )}
                >
                  {label === "look" ? (
                    <>
                      <span data-look-word />
                      <span data-look-reach className={readoutClass} />
                    </>
                  ) : (
                    <span className={cn(label === "aim" && "group-[.blocked]:hidden")}>{label}</span>
                  )}
                  {label === "aim" && <span className="hidden group-[.blocked]:inline">aim blocked</span>}
                  {label === "aim" && <span data-aim-reach className={readoutClass} />}
                  {end !== undefined && (
                    <button
                      type="button"
                      title={title}
                      className="grid size-4 cursor-pointer place-items-center rounded-full border border-sky-300/50 bg-sky-950 text-sky-100 hover:border-red-400/70 hover:text-red-300"
                      onClick={() => {
                        end();
                        w.view.focus();
                      }}
                    >
                      <XIcon className="size-3" weight="bold" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {state.notice !== null && <div className="rounded bg-neutral-900/90 px-2 py-0.5">{state.notice}</div>}
        </div>
      )}
      <div ref={(el) => void (state.barEl = el)} className={outerClass}>
        <motion.div className={column ? columnClass : rowClass} {...dragProps}>
          {/* what they are, then what they carry, scrolled: the buttons after stay in view */}
          <div ref={(el) => void (state.itemsEl = el)} className={column ? columnItemsClass : itemsClass}>
            <div className={cn("flex shrink-0", column && "flex-col")}>
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
                <>
                  <PhaserIcon armed={armed} locked={w.phasers?.isLocked(playerKey) === true} dead={dead} />
                  {w.debug?.hudDebug === true && (
                    <button
                      type="button"
                      tabIndex={-1}
                      title="debug: how every shot ends"
                      className="absolute bottom-0.5 left-1/2 -translate-x-1/2 cursor-pointer rounded border border-amber-300/50 bg-neutral-900 px-1 text-[0.6rem] text-amber-200 opacity-100!"
                      onClick={(e) => {
                        e.stopPropagation();
                        const at = shotCycle.indexOf(w.debug.forceShot);
                        w.debug.set({ forceShot: shotCycle[(at + 1) % shotCycle.length] });
                        state.update();
                        w.view.focus();
                      }}
                    >
                      {w.debug.forceShot}
                    </button>
                  )}
                </>,
              )}
              {slot(
                2,
                {
                  title: "keys",
                  had: keyCount > 0,
                  active: false,
                  plain: true,
                  menu: heldDoors.map((gdKey) => ({
                    label: `split ${gdKey}`,
                    run: () => w.e.unchainKey(playerKey, gdKey),
                  })),
                },
                <>
                  <ItemIcon kind="keychain" />
                  {keyCount > 0 && (
                    <span className="absolute right-1 bottom-3 text-xs font-bold leading-3 p-0.5 rounded bg-on-background text-background">
                      {keyCount}
                    </span>
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
                  active: state.selected === def.key,
                  drop: def.key,
                  // a keycard for a door joins the keys
                  menu: [
                    ...(def.meta?.door
                      ? [{ label: "add to keychain", run: () => w.e.chainKey(playerKey, def.key) }]
                      : []),
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
          <PlayerButtons column={column} />
        </motion.div>

        <Menu.Root open={state.menu !== null} onOpenChange={(open) => open || state.set({ menu: null })} modal={false}>
          <Menu.Portal container={w.rootEl}>
            <Menu.Positioner
              anchor={state.menu?.el}
              side={layout === "bar" ? "top" : layout === "left" ? "right" : "left"}
              sideOffset={6}
              className="z-50"
            >
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
    </>
  );
}

/** The player themself, after the slots or atop a column: where the camera stands by them, and how they go */
function PlayerButtons({ column }: { column: boolean }) {
  const w = useContext(WorldContext);
  const follow = w.view?.follow === true; // the view mounts after us
  const followFlash = useChangeCount(follow);
  const big = w.touchDevice;
  const buttonClass = cn(
    "relative grid shrink-0 cursor-pointer touch-none place-items-center overflow-hidden rounded-md hover:ring-1 hover:ring-yellow-200/25",
    big ? "size-12" : "size-9",
  );

  return (
    <div
      className={cn(
        "pointer-events-auto flex shrink-0 self-center rounded-md border border-neutral-400/25 bg-neutral-900/60",
        column ? "order-first mb-2 flex-col" : "ml-4",
      )}
      // the canvas keeps the focus
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* follow on (white) or off, as `v` */}
      <div
        className={buttonClass}
        title={`follow ${follow ? "on" : "off"}: v`}
        onClick={() => w.hud?.dragged !== true && w.view.setFollow(!follow)}
      >
        <AnimatePresence>
          {w.view?.lookingAt === true && (
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
            className={cn("pointer-events-none absolute inset-0", follow ? "bg-neutral-100" : "bg-neutral-400")}
            initial={{ opacity: 0.55 }}
            animate={{ opacity: 0 }}
            transition={{ duration: followFlashMs / 1000, ease: "easeOut" }}
          />
        )}
        <UserFocusIcon className={cn(buttonIcon(follow), "size-5")} weight="light" />
      </div>
      {/* desktop only: touch has no `wasd` */}
      {big === false && <CompassRose />}
      {/* last: right-most in the bar, bottom-most in a column */}
      <PlayerMenu buttonClass={buttonClass} iconClass={cn(buttonIcon(true), "size-5")} column={column} />
    </div>
  );
}

/** The bar's options, each saved and highlighted whilst on: toggled in place, so the menu stays open */
function PlayerMenu({ buttonClass, iconClass, column }: { buttonClass: string; iconClass: string; column: boolean }) {
  const w = useContext(WorldContext);
  const saved = getWorldStore(w.key).read();
  const [labels, setLabels] = useState(saved.roomLabelsShown);
  const side = column === false ? "top" : saved.hudLayout === "left" ? "right" : "left";
  /** Its button whilst open: opened by a click, so a drag of the bar begun on it opens nothing */
  const [anchor, setAnchor] = useState<null | HTMLDivElement>(null);
  return (
    <>
      <div
        className={buttonClass}
        title="options"
        onClick={(e) => w.hud?.dragged !== true && setAnchor(anchor === null ? e.currentTarget : null)}
      >
        <ListIcon className={iconClass} weight="light" />
      </div>
      <Menu.Root
        open={anchor !== null}
        // a press on its own button is left to that button's click, which closes it
        onOpenChange={(open, { event }) =>
          open || (anchor?.contains(event?.target as Node) === true ? undefined : setAnchor(null))
        }
        modal={false}
      >
        <Menu.Portal container={w.rootEl}>
          <Menu.Positioner anchor={anchor} side={side} sideOffset={6} className="z-50">
            <Menu.Popup className="pointer-events-auto select-none rounded-md border border-neutral-700 overflow-hidden bg-neutral-800/90 text-xs shadow-lg">
              <Menu.CheckboxItem
                className={cn(
                  "flex cursor-pointer items-center px-3 py-1 text-neutral-500 hover:bg-neutral-700 data-checked:text-amber-200",
                  w.touchDevice && "py-2 text-sm",
                )}
                checked={labels}
                closeOnClick={false}
                onCheckedChange={(shown) => {
                  setLabels(shown);
                  w.roomLabels?.setShown(shown);
                }}
              >
                room labels
              </Menu.CheckboxItem>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </>
  );
}

/** A player button's icon: white whilst what it stands for is on, else grey */
const buttonIcon = (on: boolean) =>
  cn("relative drop-shadow-[0_1px_3px_rgb(0_0_0/0.9)]", on ? "text-white" : "text-neutral-500");

/**
 * Desktop's compass, button sized: the cardinal point nearest where `w` heads, and a marker on its rim where it heads on screen.
 * Drawn once. A camera turn redraws it through `w.hud.syncCompass`, never a render
 */
const CompassRose = memo(function CompassRose() {
  const w = useContext(WorldContext);
  const { compassPoint = 0, wasdSkew = 0, wasdSnapped = true } = w.view ?? {};
  return (
    <svg
      ref={(el) => void (w.hud.compassEl = el)}
      viewBox="-18 -18 36 36"
      className="group/compass pointer-events-auto size-9 shrink-0 drop-shadow-[0_1px_3px_rgb(0_0_0/0.9)]"
      data-snapped={wasdSnapped || undefined}
    >
      <title>{`w heads ${wasdSnapped ? "" : "near "}${compassLetters[compassPoint]}`}</title>
      <circle r={13} fill="none" strokeWidth={0.8} className="stroke-neutral-500/70" />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-neutral-400 font-sans font-semibold text-[13px] group-data-snapped/compass:fill-white"
      >
        {compassLetters[compassPoint]}
      </text>
      {/* amber whilst snapped onto the axis, else pale and straight up */}
      <path
        d="M0 -17.5L3.5 -11.5L-3.5 -11.5Z"
        transform={`rotate(${(wasdSkew * 180) / Math.PI})`}
        className="fill-neutral-200 group-data-snapped/compass:fill-amber-300"
      />
    </svg>
  );
});

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

const barClass = "pointer-events-none absolute inset-x-0 bottom-6 z-10 flex select-none px-2";
/** Only its slots and buttons take the pointer, so a press between them reaches the World */
const rowClass = "pointer-events-none mx-auto flex max-w-full";
/** Its slots, scrolled sideways once they outgrow a narrow World; padded, else the scroll clips a slot's ring */
const itemsClass = "pointer-events-none flex min-w-0 overflow-x-auto p-1 [scrollbar-width:none]";
/** The bar as a column on either side */
const columnBarClass = "pointer-events-none absolute top-0 z-10 select-none";
const columnClass = "pointer-events-none flex flex-col items-center";
const columnItemsClass = "pointer-events-none flex min-h-0 flex-col overflow-y-auto p-0 [scrollbar-width:none]";
/** The notices: top centre, clear of the bar */
const noticesClass =
  "pointer-events-none absolute top-5 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1 whitespace-nowrap text-xs text-amber-200";
/** A distance as a device reads it out: a fixed width, so the notice never changes length */
const readoutClass =
  "box-content w-[5ch] rounded-sm bg-black px-1 text-right font-mono text-[11px] text-lime-300 tabular-nums shadow-[inset_0_0_3px_rgb(0_0_0)] ring-1 ring-lime-900/70";

/** Writes `metres` into a readout, hidden without one. Only on a change: it runs each frame */
function setReadout(el: null | HTMLElement, metres: null | number) {
  const text = metres === null ? "" : `${Math.min(metres, 99.9).toFixed(1)}m`;
  if (el === null || el.textContent === text) return;
  el.textContent = text;
  el.style.display = text === "" ? "none" : "";
}

/** Each icon's size, as a fraction of its slot's height (else `--hud-icon-base`): alike, bar art that fills its square */
const iconScale: Record<"psi" | "keychain" | ItemKind, number> = {
  psi: 0.7,
  phaser: 0.7,
  keychain: 0.7,
  book: 0.6,
  box: 0.7,
  "box-case": 0.7,
  "box-crate": 0.7,
  "box-tote": 0.7,
  keycard: 0.58,
};
const iconStyle = (kind: keyof typeof iconScale) => ({
  height: `calc(var(--hud-icon-base, 100%) * ${iconScale[kind]})`,
});

/** The shadow is each icon's own */
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
 * The firing is html over a still svg: animating the svg itself repaints it every frame
 */
const BrainIcon = memo(function BrainIcon({ firing, paused }: { firing: boolean; paused: boolean }) {
  const animationPlayState = paused ? "paused" : "running";
  return (
    <div className="relative aspect-square" style={iconStyle("psi")} role="img" aria-label="psi">
      <svg className={cn("size-full", iconShadow)} viewBox="0 0 64 64" aria-hidden="true">
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
      </svg>
      {/* axons, a pulse running down each in turn: fixed dots, as a moving one is repainted */}
      {firing === true &&
        brainPulses.map(([x, y, begin], i) => (
          <div
            key={i}
            className="hud-pulse"
            style={{ left: brainPct(x), top: brainPct(y), animationDelay: `${begin}s`, animationPlayState }}
          />
        ))}
      {brainNeurons.map(([cx, cy, begin], i) => (
        <div
          key={i}
          className={cn("hud-neuron", firing && "hud-neuron-firing")}
          style={{ left: brainPct(cx), top: brainPct(cy), animationDelay: `${begin}s`, animationPlayState }}
        />
      ))}
    </div>
  );
});

/** Of the icon's 64 unit square */
const brainPct = (units: number) => `${(units / 64) * 100}%`;

/** Seconds a pulse takes to run down its axon */
const brainPulseSecs = 1.6;

/** A quadratic curve: from, control, to */
type BrainCurve = [x0: number, y0: number, cx: number, cy: number, x1: number, y1: number];

/** `[curve, seconds in]`, each from one of `brainNeurons` to the next */
const brainAxons: [BrainCurve, number][] = [
  [[14, 30, 20, 22, 27, 21], 0],
  [[27, 21, 35, 15, 44, 19], 0.5],
  [[44, 19, 52, 24, 50, 33], 1],
  [[27, 21, 30, 30, 37, 34], 0.6],
  [[37, 34, 44, 38, 50, 33], 1.2],
  [[14, 30, 20, 38, 28, 39], 1.5],
  [[28, 39, 33, 38, 37, 34], 2],
];

/** `[x, y, seconds in]` of each step of a pulse, five to an axon */
const brainPulses = brainAxons.flatMap(([[x0, y0, cx, cy, x1, y1], begin]) =>
  [1, 2, 3, 4, 5].map((step): [number, number, number] => {
    const t = step / 6;
    return [
      (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t ** 2 * x1,
      (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t ** 2 * y1,
      begin + t * brainPulseSecs,
    ];
  }),
);

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
]);

/** The bar's height */
const hudBarHeight = 110;
/** How near the World's top the bar may be dragged: below the notices */
const noticesHeight = 68;
/** The space kept between the column and the menu's, and below the column */
const columnGap = 8;
/** A touch column slot's height, padded: the least the column's slots shrink to */
const columnSlotHeight = 56;
/** Where the column starts, before any drag: the menu's makes way */
const defaultColumnY = 180;
/** Compass points by `w.view.compassPoint` */
const compassLetters = ["N", "W", "S", "E"];
/** How long a touch is held before a slot's menu opens */
const longPressMs = 500;
/** How long the follow button's flash takes to fade, when follow is turned on or off */
const followFlashMs = 550;
/** Half a pulse of the follow button, whilst a pan is under way */
const lookingAtPulseMs = 700;
/** How long the pulse takes to fade once the pan lands */
const lookingAtFadeMs = 400;

/** How long the bar's notice shows */
const noticeMs = 1500;

type SlotMenuItem = { label: string; run(): void };

/** A notice kept over the bar, its `end` the "x" */
type Kept = { label: string; title: string; end?: () => void };

/** What the debug badge cycles through: `null` leaves it to jsh */
const shotCycle: JshCli.ShotOutcome[] = ["hit", "ghost", "armour"];

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
};

export type State = {
  barEl: null | HTMLDivElement;
  /** What is dragged: the row, or the column */
  colEl: null | HTMLDivElement;
  compassEl: null | SVGSVGElement;
  /** The bar is being dragged, so what ends on it is no press */
  dragged: boolean;
  /** The slots, scrolled once they outgrow the bar */
  itemsEl: null | HTMLDivElement;
  /** In a column, caps the slots so it fits, beside the menu's on the left. Run as either resizes */
  fitColumns(): void;
  /** How far up and down it may be dragged, as `y` offsets */
  getDragBounds(): { top: number; bottom: number };
  /** Along the bottom, or a column on either side: the debug "hud" select */
  getLayout(): HudLayout;
  /** Where it was last dragged to, in its layout */
  getSavedY(): number;
  /** Whether it is a column on either side */
  isColumn(): boolean;
  /** In the left column, moves it or the menu's out of `moved`'s way */
  makeWay(moved: "hud" | "menu"): void;
  persistY(): void;
  /** The slot whose right-click menu shows, hung off its element */
  menu: null | { index: number; el: HTMLElement };
  pressTimer: number;
  /** The touch now ending opened the menu, so is no press */
  longPressed: boolean;
  /** The key of the carried item a press chose, a second press letting it go */
  selected: null | string;
  /** Its drag offset */
  y: MotionValue<number>;
  /** Puts an item of the player's at their feet: the slot's "x" */
  drop(name: string): void;
  /** What the bar says above itself, a moment: something of theirs was refused */
  notice: null | string;
  noticeTimer: number;
  say(notice: string): void;
  /** Redraws the compass from `w.view`, as the camera turns */
  syncCompass(): void;
  /** What they carry, in slot order — their phaser has a slot of its own */
  getItems(): Geomorph.DecorDef[];
  /** The notices kept over the bar. A raised phaser strafes them too, which only lowering it ends */
  getKept(): Kept[];
  /** As a click on that slot, from `0`: psi, phaser, keys, then items */
  press(index: number): void;
  /** Marks the "aim" notice blocked whilst something in the way draws the phaser in. A ref, returning its cleanup */
  watchAim(el: null | HTMLDivElement): undefined | (() => void);
  /** The "focus" notice of focus mode, else "look" whilst a cap holds, with the cap's reach. Greyed whilst focus mode yields */
  watchLook(el: null | HTMLDivElement): undefined | (() => void);
};
