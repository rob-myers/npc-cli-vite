import { cn, useStateRef } from "@npc-cli/util";
import { Picker } from "@npc-cli/util/picker";
import { ArrowCounterClockwiseIcon, DotsSixIcon } from "@phosphor-icons/react";
import { type ButtonHTMLAttributes, memo, type ReactNode, useContext, useEffect, useState } from "react";
import * as THREE from "three/webgpu";
import { doorHeight } from "../const.env";
import { actionClass, cancelClass, markClass, OverlayBounds, offsetUnder, toScreen } from "../service/overlay";
import { bodyPart, bodyPartPoint } from "../service/phaser-beam";
import { slotOf } from "../service/room-slots";
import BreathControls from "./BreathControls";
import type { AnimationClipKey } from "./NPCs";
import { WorldContext } from "./world-context";

/**
 * A menu on an npc, a decor or a door, pinned beside it until closed: opened by a right click or long
 * press whilst the debug "context menu" is on. Several may be open. Each may collapse to its top row
 */
export default function PickMenu() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      boxes: new OverlayBounds(() => w.r3f?.invalidate()),
      el: null,
      menus: new Map(),
      observer: new ResizeObserver((items) => state.onResize(items)),
      touches: new Set(),
      waiting: new Map(),

      anchorOf({ target, picked }, out) {
        if ("npcKey" in target) {
          const npc = w.n?.[target.npcKey];
          if (npc === undefined) return null;
          // where it was pressed, moving with that part of them
          const bone = picked === null ? undefined : bodyPart(npc, picked.part)?.bone;
          if (bone === undefined || picked === null) return bodyPartPoint(npc, "chest", out);
          bone.updateWorldMatrix(true, false);
          return out.copy(picked.local).applyMatrix4(bone.matrixWorld);
        }
        if ("decorKey" in target) {
          const d = w.decor.byKey[target.decorKey];
          if (d === undefined) return null;
          if (picked !== null) return out.copy(picked.local);
          const { x, y } = d.type === "point" ? d : d.center;
          return out.set(x, typeof d.meta.y === "number" ? d.meta.y : 0, y);
        }
        const door = w.door.byKey[target.gdKey];
        if (door === undefined) return null;
        if (picked !== null) return out.copy(picked.local);
        return out.set((door.src.x + door.dst.x) / 2, doorHeight / 2, (door.src.y + door.dst.y) / 2);
      },
      close(...menuKeys) {
        let focused = false;
        for (const menuKey of menuKeys) {
          const entry = state.menus.get(menuKey);
          if (entry === undefined) continue;
          focused ||= entry.el?.contains(document.activeElement) === true;
          state.menus.delete(menuKey);
        }
        if (focused === true) w.view.focus(); // else keys miss the World
        state.update();
      },
      closeAll() {
        state.close(...state.menus.keys());
      },
      closeFocused() {
        const entry = [...state.menus.values()].find(({ el }) => el?.contains(document.activeElement) === true);
        if (entry === undefined) return false;
        state.close(entry.menuKey);
        return true;
      },
      concernedBy(e) {
        const menuKeys = [] as string[];
        if (menuEvents.has(e.key) === false) return menuKeys;
        for (const { menuKey, target } of state.menus.values()) {
          const concerned =
            "npcKey" in target
              ? ("npcKey" in e && e.npcKey === target.npcKey && npcEvents.has(e.key)) || roomEvents.has(e.key)
              : (e.key === "decor-created" && "decorKey" in target && e.decorKeys.includes(target.decorKey)) ||
                ("gdKey" in e && doorEvents.has(e.key) && e.gdKey === target.gdKey);
          if (concerned === true) menuKeys.push(menuKey);
        }
        return menuKeys;
      },
      dragFrom(menuKey, e) {
        const entry = state.menus.get(menuKey);
        if (entry?.rect == null) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        entry.drag = { x: e.clientX, y: e.clientY, rect: { ...entry.rect } };
      },
      dragTo(menuKey, e) {
        const entry = state.menus.get(menuKey);
        if (entry?.drag == null || entry.at === null) return;
        const { drag } = entry;
        const rect = { ...drag.rect, x: drag.rect.x + e.clientX - drag.x, y: drag.rect.y + e.clientY - drag.y };
        const meet = nearestOnRect(entry.at, rect);
        const [dx, dy] = [meet.x - entry.at.x, meet.y - entry.at.y];
        // no further than `maxDragM` from its anchor, at its anchor's depth
        const scale = Math.min(1, (pickMenuConfig.maxDragM * state.pxPerMetre(entry)) / (Math.hypot(dx, dy) || 1));
        const wasDragged = entry.dragged !== null;
        entry.pin = { x: (meet.x - rect.x) / (rect.width || 1), y: (meet.y - rect.y) / (rect.height || 1) };
        entry.dragged = { x: dx * scale, y: dy * scale };
        if (wasDragged === false) state.touch(menuKey); // lights its reset
        w.r3f?.invalidate();
      },
      fadeOf(target) {
        const { fadeRoomsFx } = w.view;
        if ("npcKey" in target) {
          const npc = w.n?.[target.npcKey];
          if (npc === undefined) return 1;
          return Math.max(fadeRoomsFx.visibilityOf(npc.roomSlot.value), npc.npcLit.value * w.view.litNpcsEnabled.value);
        }
        if ("decorKey" in target) {
          const { gmId, roomId } = w.decor.byKey[target.decorKey]?.meta ?? {};
          return typeof gmId === "number" && typeof roomId === "number" && roomId >= 0
            ? fadeRoomsFx.visibilityOf(slotOf(gmId, roomId))
            : 1;
        }
        const door = w.door.byKey[target.gdKey];
        if (door === undefined) return 1;
        let shown = 0;
        for (const roomId of door.connector.roomIds) {
          if (roomId !== null) shown = Math.max(shown, fadeRoomsFx.visibilityOf(slotOf(door.gmId, roomId)));
        }
        return shown;
      },
      measure(entry) {
        const { el, cancelEl } = entry;
        if (el === null || cancelEl === null) return;
        entry.size = {
          width: el.offsetWidth,
          height: el.offsetHeight,
          cx: cancelEl.offsetLeft + cancelEl.offsetWidth / 2,
          cy: cancelEl.offsetTop + cancelEl.offsetHeight / 2,
        };
      },
      onResize(items) {
        for (const { target } of items) {
          for (const entry of state.menus.values()) entry.el === target && state.measure(entry);
        }
        w.r3f?.invalidate();
      },
      onTouchDown(e) {
        if (e.pointerType !== "touch") return;
        const onMenu = state.el?.contains(e.target as Node) === true;
        // another finger joins: those on menus are the camera's now, so the two pinch
        if (state.touches.size > 0) {
          for (const waiting of state.waiting.values())
            w.view.canvas.dispatchEvent(new PointerEvent("pointerdown", waiting));
          state.waiting.clear();
          if (onMenu === true) {
            e.stopPropagation(); // not a press on the menu
            w.view.canvas.dispatchEvent(new PointerEvent("pointerdown", e));
          }
        } else if (onMenu === true) {
          state.waiting.set(e.pointerId, e); // the menu's, unless another finger joins
        }
        state.touches.add(e.pointerId);
      },
      onTouchUp(e) {
        state.touches.delete(e.pointerId);
        state.waiting.delete(e.pointerId);
      },
      open(target, pressed) {
        const menuKey = menuKeyOf(target);
        const entry = state.menus.get(menuKey) ?? newEntry(menuKey, target);
        state.menus.delete(menuKey); // to the front
        state.menus.set(menuKey, unpin(entry, pressed !== undefined)); // opened again, placed afresh
        entry.picked = pressed === undefined ? null : state.pickedOf(target, pressed);
        entry.version++;
        entry.wantsFocus = w.touchDevice === false;
        state.update();
        w.r3f?.invalidate();
      },
      place() {
        const camera = w.r3f?.camera;
        if (camera === undefined) return;
        const { boxes } = state;
        if (boxes.sync(state.el, w.view.canvas ?? null) === false) return;
        const { canvas, box } = boxes;
        camera.updateMatrixWorld(); // as it is this frame, not the last
        const { down } = w.view.lastPointer;
        // nothing is read from the DOM here: sizes come from `measure`, so no write forces a layout
        for (const entry of state.menus.values()) {
          const { el, size } = entry;
          if (el === null || size === null) continue;
          const point = state.anchorOf(entry, tmpPoint);
          el.inert = point === null;
          if (point === null) {
            setStyle(el, "opacity", "0");
            if (entry.originEl !== null) setStyle(entry.originEl, "opacity", "0");
            continue;
          }
          const at = toScreen(point, camera, canvas, box);
          const behind = point.z > 1;
          const { width, height, cx, cy } = size;
          let [mx, my] = [0, 0];
          let meet: Geom.VectJson;
          if (entry.dragged !== null && entry.pin !== null) {
            // dragged: its lines keep their lengths, so it may leave the view
            meet = { x: at.x + entry.dragged.x, y: at.y + entry.dragged.y };
            // the same share of it, e.g. its middle, however it has resized since
            [mx, my] = [meet.x - entry.pin.x * width, meet.y - entry.pin.y * height];
          } else {
            // Cancel under the press that opened it, else beside its anchor. Kept in view
            entry.offset ??= entry.atPointer
              ? offsetUnder(down, at, canvas, box)
              : { x: pickMenuConfig.offPx + cx, y: 0 };
            mx = Math.max(0, Math.min(at.x + entry.offset.x - cx, box.width - width));
            my = Math.max(0, Math.min(at.y + entry.offset.y - cy, box.height - height));
            meet = nearestOnRect(at, { x: mx, y: my, width, height });
          }
          const opacity = behind ? "0" : `${Math.max(pickMenuConfig.fadeFloor, state.fadeOf(entry.target)).toFixed(2)}`;
          setStyle(el, "transform", `translate(${px(mx)},${px(my)})`);
          setStyle(el, "opacity", opacity);
          entry.at = at;
          entry.rect = { x: mx, y: my, width, height };
          state.placeOrigin(entry, at, meet, opacity);
        }
      },
      placeOrigin(entry, at, to, opacity) {
        const { originEl } = entry;
        if (originEl === null) return;
        setStyle(originEl, "opacity", opacity);
        const [dot, v, h] = originEl.children as unknown as HTMLElement[];
        setStyle(dot, "transform", `translate(${px(at.x)},${px(at.y)}) translate(-50%,-50%)`);
        setStyle(h, "transform", `translate(${px(Math.min(at.x, to.x))},${px(at.y)})`);
        setStyle(h, "width", px(Math.abs(to.x - at.x)));
        setStyle(v, "transform", `translate(${px(to.x)},${px(Math.min(at.y, to.y))})`);
        setStyle(v, "height", px(Math.abs(to.y - at.y)));
      },
      pickedOf(target, { point, part }) {
        if (!("npcKey" in target)) return { part: null, local: new THREE.Vector3().copy(point) };
        const npc = w.n?.[target.npcKey];
        const bone = npc === undefined ? undefined : bodyPart(npc, part ?? null)?.bone;
        if (bone === undefined) return null; // e.g. their label: their chest
        bone.updateWorldMatrix(true, false);
        const local = new THREE.Vector3().copy(point).applyMatrix4(tmpMatrix.copy(bone.matrixWorld).invert());
        return { part: bone.name, local };
      },
      pxPerMetre(entry) {
        const camera = w.r3f?.camera;
        const height = state.boxes.canvas?.height;
        const point = state.anchorOf(entry, tmpPoint);
        if (camera === undefined || height === undefined || point === null) return Number.POSITIVE_INFINITY;
        if (camera instanceof THREE.OrthographicCamera) return (height * camera.zoom) / (camera.top - camera.bottom);
        if (!(camera instanceof THREE.PerspectiveCamera)) return Number.POSITIVE_INFINITY;
        const depth = -point.applyMatrix4(camera.matrixWorldInverse).z;
        return height / (2 * Math.max(depth, 0.01) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      },
      resetOffset(menuKey) {
        const entry = state.menus.get(menuKey);
        if (entry === undefined) return;
        state.settle(unpin(entry, false)); // beside its anchor
        state.touch(menuKey); // dims its reset
        w.r3f?.invalidate();
      },
      setCollapsed(menuKey, next = !collapsedKeys.has(menuKey)) {
        if (next === true) collapsedKeys.add(menuKey);
        else collapsedKeys.delete(menuKey);
        const entry = state.menus.get(menuKey);
        if (entry !== undefined) state.settle(entry);
        state.update();
      },
      settle(entry) {
        for (const el of [entry.el, entry.originEl]) el?.setAttribute("data-settling", "");
        window.clearTimeout(entry.settleId);
        entry.settleId = window.setTimeout(() => {
          for (const el of [entry.el, entry.originEl]) el?.removeAttribute("data-settling");
        }, pickMenuConfig.settleMs);
      },
      toggle(target) {
        const menuKey = menuKeyOf(target);
        state.menus.has(menuKey) ? state.close(menuKey) : state.open(target);
      },
      touch(...menuKeys) {
        const entries = menuKeys.flatMap((menuKey) => state.menus.get(menuKey) ?? []);
        for (const entry of entries) entry.version++;
        if (entries.length > 0) state.update();
      },
    }),
  );

  w.pickMenu = state;

  useEffect(() => {
    const sub = w.events.subscribe({
      next(e) {
        if (state.menus.size === 0) return;
        if (e.key === "map-changing") return state.closeAll();
        if (e.key === "removed-npcs") state.close(...e.npcKeys.map((npcKey) => menuKeyOf({ npcKey })));
        // not at once: an edit removes the decor it replaces first
        if (e.key === "decor-removed") {
          queueMicrotask(() => {
            const gone = e.decorKeys.filter((decorKey) => !(decorKey in w.decor.byKey));
            if (gone.length > 0) state.close(...gone.map((decorKey) => menuKeyOf({ decorKey })));
          });
        }
        state.touch(...state.concernedBy(e));
      },
    });
    // before the press reaches a menu or the canvas, so a pinch may begin on either
    const ac = new AbortController();
    const opts = { capture: true, signal: ac.signal };
    w.rootEl.addEventListener("pointerdown", (e) => state.onTouchDown(e), opts);
    document.addEventListener("pointerup", (e) => state.onTouchUp(e), opts);
    document.addEventListener("pointercancel", (e) => state.onTouchUp(e), opts);
    return () => {
      sub.unsubscribe();
      ac.abort();
      state.observer.disconnect();
      state.boxes.dispose();
    };
  }, []);

  const open = state.menus.size > 0;

  useEffect(() => {
    if (open === false) return;
    // over its anchor in the World's own frame, after the camera has moved
    return w.e.addFrameCallback(() => state.place());
  }, [open]);

  return (
    <div
      ref={(el) => void (state.el = el)}
      className="pointer-events-none absolute inset-0 z-20 select-none overflow-hidden"
    >
      {[...state.menus.values()].map((entry) => (
        <Menu key={entry.menuKey} entry={entry} version={entry.version} collapsed={collapsedKeys.has(entry.menuKey)} />
      ))}
    </div>
  );
}

/** One open menu, rendered again only when it changes: see `touch` */
const Menu = memo(function Menu({ entry, collapsed }: { entry: Entry; version: number; collapsed: boolean }) {
  const w = useContext(WorldContext);
  const state = w.pickMenu;
  const { target, menuKey } = entry;
  const touch = () => state.touch(menuKey);

  return (
    <>
      {/* where it is pinned: a dot, then a line across, then up or down to where they meet it */}
      <div ref={(el) => void (entry.originEl = el)} style={{ opacity: 0 }} className="group/origin absolute inset-0">
        <div className={cn(originClass, "size-1.5 rounded-full bg-white/70")} />
        <div className={cn(originClass, "w-0 border-l border-dashed border-white/50")} />
        <div className={cn(originClass, "h-0 border-t border-dashed border-white/50")} />
      </div>
      <div
        ref={(el) => {
          if (entry.el !== el) {
            if (entry.el !== null) state.observer.unobserve(entry.el);
            if (el !== null) state.observer.observe(el);
          }
          entry.el = el;
          if (el === null || entry.wantsFocus === false) return;
          entry.wantsFocus = false;
          el.focus({ preventScroll: true });
        }}
        // focused, Escape closes it. The World's keys still reach it
        tabIndex={0}
        style={{ opacity: 0 }} // until placed
        className={cn(
          markClass,
          "flex w-max max-w-72 touch-none flex-col items-start gap-1 rounded font-mono text-[11px] text-white outline-none focus:ring-1 focus:ring-sky-300/60",
          // eased into place for a moment, e.g. having collapsed, else it lags whom it follows
          "data-settling:transition-[opacity,transform] data-settling:duration-150",
        )}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()} // not the browser's
        // the camera still zooms beneath it
        onWheel={(e) => {
          // a sideways scroll over its label scrolls the label
          const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
          if (sideways && (e.target as Element).closest("[data-scroll-x]") !== null) return;
          w.view.forwardWheel(e);
        }}
        // the menu takes the focus, not a row: Space must not press one. A slider needs its own
        onMouseDown={(e) => {
          if (e.target instanceof HTMLInputElement) return;
          e.preventDefault();
          entry.el?.focus({ preventScroll: true });
        }}
      >
        <div className="flex items-center gap-1 self-stretch">
          <Button
            ref={(el) => void (entry.cancelEl = el)}
            title="close"
            className={cancelClass}
            onClick={() => state.close(menuKey)}
          >
            ✕
          </Button>
          <Button
            title={collapsed ? "expand" : "collapse"}
            className={actionClass}
            onClick={() => state.setCollapsed(menuKey)}
          >
            {collapsed ? "▸" : "▾"}
          </Button>
          <ScrollLabel text={labelOf(target)} />
          <Button
            title="drag, double click to reset"
            className={cn(
              actionClass,
              "flex min-w-8 flex-1 cursor-grab touch-none justify-center bg-gray-700/40 active:cursor-grabbing",
            )}
            onPointerDown={(e) => state.dragFrom(menuKey, e)}
            onPointerMove={(e) => state.dragTo(menuKey, e)}
            onPointerUp={() => void (entry.drag = null)}
            onPointerCancel={() => void (entry.drag = null)}
            onLostPointerCapture={() => void (entry.drag = null)} // e.g. a pinch took the finger
            onDoubleClick={() => state.resetOffset(menuKey)}
          >
            <DotsSixIcon className="size-3" weight="bold" />
          </Button>
          <Button
            title="back beside it"
            className={cn(actionClass, entry.dragged === null && "opacity-40")}
            onClick={() => state.resetOffset(menuKey)}
          >
            <ArrowCounterClockwiseIcon className="size-3" weight="bold" />
          </Button>
        </div>
        {collapsed === false && (
          <div className="pointer-events-auto flex flex-col items-start gap-1 rounded bg-black/40 p-1">
            {"npcKey" in target && <NpcRows npcKey={target.npcKey} touch={touch} />}
            {"decorKey" in target && <DecorRows decorKey={target.decorKey} />}
            {"gdKey" in target && target.gdKey !== undefined && <DoorRows gdKey={target.gdKey} touch={touch} />}
          </div>
        )}
      </div>
    </>
  );
});

/** `touch` renders their menu again, the change announced or not, e.g. a gift */
function NpcRows({ npcKey, touch }: { npcKey: string; touch(): void }) {
  const w = useContext(WorldContext);
  const npc = w.n?.[npcKey];
  if (npc === undefined) return null;
  const grKey = w.npc.npcToRoom.get(npcKey)?.grKey;
  const act = (fn: () => void) => () => (fn(), touch());

  return (
    <>
      {grKey !== undefined && <Info label="room">{grKey}</Info>}
      <Picker
        value={npc.anim.pose}
        options={Object.keys(npc.clips) as AnimationClipKey[]}
        title="anim"
        className="pointer-events-auto border-white/20 bg-black/60 text-white"
        popupClassName="font-mono"
        onChange={(next) => {
          if (w.n[npcKey] === undefined) return;
          w.n[npcKey].anim.setHurt(null); // else they go back to it
          w.n[npcKey].anim.setPose(next);
          touch();
        }}
      />
      {/* what they have: lit if so, and a press gives or takes it away */}
      <div className="flex flex-wrap gap-1">
        {(["psi", "phaser"] as const).map((name) => {
          const had = w.e.hasItem(npcKey, name);
          return (
            <Toggle
              key={name}
              on={had}
              title={`${had ? "take away" : "give"} ${name}`}
              onClick={act(() => (had ? w.e.revokeItem(npcKey, name) : w.e.giveItem(npcKey, name)))}
            >
              {name}
            </Toggle>
          );
        })}
        <Toggle
          on={npc.anim.breath.on}
          title={`${npc.anim.breath.on ? "stop" : "start"} breathing`}
          onClick={act(() => npc.anim.setBreathing(!npc.anim.breath.on))}
        >
          breath
        </Toggle>
        {npcKey !== w.player?.key && (
          <Toggle on={npc.lit} onClick={act(() => w.e.setNpcLit(npc))}>
            lit
          </Toggle>
        )}
        {npcKey !== w.player?.key && (
          <Toggle on={w.npcFocus.lasers.has(npcKey)} onClick={act(() => w.npcFocus.setLaser(npcKey))}>
            laser
          </Toggle>
        )}
        {/* the speech menu's added items e.g. picked */}
        {w.speech.menuItems.map((item) => (
          <Toggle key={item.key} on={item.on?.(npcKey)} onClick={act(() => item.action(npcKey))}>
            {item.text}
          </Toggle>
        ))}
      </div>
      {npcKey === w.player?.key && <BreathControls w={w} />}
    </>
  );
}

/** Static decor shows what it is. Runtime decor may also be shown or hidden, or deleted */
function DecorRows({ decorKey }: { decorKey: string }) {
  const w = useContext(WorldContext);
  const d = w.decor.byKey[decorKey];
  if (d === undefined) return null;
  const def = w.decor.runtime.defByKey[decorKey];
  const meta = Object.entries(d.meta).filter(([k]) => hiddenMeta.has(k) === false);

  return (
    <>
      <div className="flex flex-wrap gap-1">
        <Info label="type">{d.type}</Info>
        {typeof d.meta.img === "string" && <Info label="img">{d.meta.img}</Info>}
        <Info label="room">{String(d.meta.grKey ?? "none")}</Info>
      </div>
      {meta.length > 0 && (
        <div className="grid max-w-full grid-cols-[auto_1fr] gap-x-2 px-1.5 text-white/80">
          {meta.map(([k, v]) => (
            <MetaRow key={k} k={k} v={v} />
          ))}
        </div>
      )}
      {def !== undefined && (
        <div className="flex flex-wrap gap-1">
          {def.type !== "quad" && (
            <Toggle
              on={def.meta?.shown === true}
              onClick={() => void w.decor.create({ ...def, meta: { ...def.meta, shown: def.meta?.shown !== true } })}
            >
              shown
            </Toggle>
          )}
          <DeleteButton onDelete={() => w.decor.remove(decorKey)} />
        </div>
      )}
    </>
  );
}

/** A meta key and its value, as two cells of the grid */
function MetaRow({ k, v }: { k: string; v: unknown }) {
  return (
    <>
      <span className="text-white/50">{k}</span>
      <span className="truncate">{typeof v === "string" ? v : JSON.stringify(v)}</span>
    </>
  );
}

function DoorRows({ gdKey, touch }: { gdKey: Geomorph.GmDoorKey; touch(): void }) {
  const w = useContext(WorldContext);
  const door = w.door.byKey[gdKey];
  if (door === undefined) return null;
  const rows: [string, boolean, () => void][] = [
    ["open", door.open, () => w.e.toggleDoor(gdKey, door.open ? { close: true } : { open: true })],
    ["held", door.held, () => w.door.setHeld(door, !door.held)],
    ["locked", door.locked, () => w.e.toggleLock(gdKey, {})],
    ["auto", door.auto, () => w.door.setFlag(door, "auto", !door.auto)],
    ["proximity", door.proximity, () => w.door.setFlag(door, "proximity", !door.proximity)],
  ];

  return (
    <div className="flex flex-wrap gap-1">
      {door.sealed === true && <Info label="door">sealed</Info>}
      {rows.map(([text, on, fn]) => (
        <Toggle key={text} on={on} disabled={door.sealed} onClick={() => (fn(), touch())}>
          {text}
        </Toggle>
      ))}
    </div>
  );
}

/** A menu's button, out of the tab order: the menu takes the focus */
function Button(props: ButtonHTMLAttributes<HTMLButtonElement> & { ref?: React.Ref<HTMLButtonElement> }) {
  return <button type="button" tabIndex={-1} {...props} />;
}

/** A menu's button: amber whilst `on`, dim whilst off, plain if neither */
function Toggle({
  on,
  ...props
}: {
  on?: boolean;
  disabled?: boolean;
  title?: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <Button
      className={cn(
        actionClass,
        "opacity-100 disabled:cursor-default disabled:opacity-40",
        on === true && "text-amber-200 ring-1 ring-amber-300/60",
        on === false && "text-white/50 hover:text-white/80",
      )}
      {...props}
    />
  );
}

/** Deletes on a second press, made within `confirmMs` */
function DeleteButton({ onDelete }: { onDelete(): void }) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (confirming === false) return;
    const timeoutId = window.setTimeout(() => setConfirming(false), confirmMs);
    return () => window.clearTimeout(timeoutId);
  }, [confirming]);

  return (
    <Button
      className={cn(actionClass, "text-red-300", confirming && "ring-1 ring-red-400")}
      onClick={() => (confirming ? onDelete() : setConfirming(true))}
    >
      {confirming ? "press again to delete" : "delete"}
    </Button>
  );
}

/** Its text, at most 10 characters wide: longer, it scrolls sideways and fades at an edge with more beyond */
function ScrollLabel({ text }: { text: string }) {
  return (
    <span
      ref={(el) => void (el !== null && fadeEdges(el))}
      data-scroll-x=""
      onScroll={(e) => fadeEdges(e.currentTarget)}
      onWheel={(e) => {
        // Shift and a wheel scrolls it, as a trackpad's sideways swipe does
        if (e.shiftKey && e.deltaX === 0) e.currentTarget.scrollLeft += e.deltaY;
      }}
      className="pointer-events-auto max-w-[calc(10ch+0.75rem)] touch-pan-x overflow-x-auto whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 [scrollbar-width:none]"
    >
      {text}
    </span>
  );
}

/** Fades each edge of `el` with more of it scrolled beyond */
function fadeEdges(el: HTMLElement) {
  const before = el.scrollLeft > 0;
  const after = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  el.style.maskImage =
    before || after
      ? `linear-gradient(to right, ${before ? "transparent, black 1em" : "black"}, ${after ? "black calc(100% - 1em), transparent" : "black"})`
      : "";
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="max-w-full truncate rounded bg-black/40 px-1.5 py-0.5 text-white/80">
      <span className="text-white/50">{label} </span>
      {children}
    </span>
  );
}

const menuKeyOf = (target: PickMenuTarget) =>
  "npcKey" in target
    ? `npc:${target.npcKey}`
    : "decorKey" in target
      ? `decor:${target.decorKey}`
      : `door:${target.gdKey}`;

const labelOf = (target: PickMenuTarget) =>
  "npcKey" in target ? target.npcKey : "decorKey" in target ? target.decorKey : target.gdKey;

const newEntry = (menuKey: string, target: PickMenuTarget): Entry => ({
  menuKey,
  target,
  picked: null,
  atPointer: false,
  version: 0,
  offset: null,
  dragged: null,
  pin: null,
  at: null,
  rect: null,
  size: null,
  drag: null,
  el: null,
  cancelEl: null,
  originEl: null,
  settleId: 0,
  wantsFocus: false,
});

/** Undoes any drag, so it is placed afresh. `atPointer`: its Cancel goes under the last press */
const unpin = (entry: Entry, atPointer: boolean) =>
  Object.assign(entry, { atPointer, offset: null, dragged: null, pin: null });

/** The point of `rect` nearest `p`: `p` itself if inside */
function nearestOnRect(p: Geom.VectJson, rect: Geom.RectJson): Geom.VectJson {
  return {
    x: Math.max(rect.x, Math.min(p.x, rect.x + rect.width)),
    y: Math.max(rect.y, Math.min(p.y, rect.y + rect.height)),
  };
}

/** A mark of where a menu is pinned, eased with it whilst it settles */
const originClass =
  "absolute top-0 left-0 group-data-settling/origin:transition-[transform,width,height] group-data-settling/origin:duration-150";

/** Writes `el.style[prop]`, unless that is what was last written */
function setStyle(el: HTMLElement, prop: "transform" | "opacity" | "width" | "height", value: string) {
  let last = written.get(el);
  if (last === undefined) written.set(el, (last = {}));
  if (last[prop] === value) return;
  el.style[prop] = last[prop] = value;
}
/** What `setStyle` last wrote, by element */
const written = new WeakMap<HTMLElement, Record<string, string>>();
/** Pixels, to a tenth: finer than that is no change */
const px = (n: number) => `${n.toFixed(1)}px`;

/** By menu key, those collapsed: kept for the session, over hmr too */
const collapsedKeys = new Set<string>();

/** Events about an npc which may change their menu */
const npcEvents = new Set<string>([
  "carried",
  "enter-room",
  "npc-posed",
  "npc-toggled",
] satisfies JshCli.Event["key"][]);
/** Events after which any npc's room may differ */
const roomEvents = new Set<string>(["nav-updated", "requested-physics"] satisfies JshCli.Event["key"][]);
/** Events about a door which may change its menu, or its switch's */
const doorEvents = new Set<string>([
  "door-closed",
  "door-locked",
  "door-open",
  "door-toggled",
  "door-unlocked",
] satisfies JshCli.Event["key"][]);
/** Any event which may change a menu */
const menuEvents = new Set([...npcEvents, ...roomEvents, ...doorEvents, "decor-created"]);

/** Meta shown elsewhere, or only of use within */
const hiddenMeta = new Set([
  ...["decor", "decorKey", "decorId", "gmId", "roomId", "grKey", "gridMin", "gridMax"],
  ...["point", "rect", "circle", "quad", "img"],
]);
const confirmMs = 3000;

const tmpPoint = new THREE.Vector3();
const tmpMatrix = new THREE.Matrix4();

const pickMenuConfig = {
  /** Least opacity, so a menu on one out of view is still usable */
  fadeFloor: 0.75,
  /** Pixels right of its anchor a menu opened without a press goes */
  offPx: 28,
  /** Metres from its anchor a drag may take where its lines meet it, at its anchor's depth */
  maxDragM: 1.5,
  /** Milliseconds a menu eases into place, e.g. having collapsed */
  settleMs: 200,
} as const;

export type PickMenuTarget =
  | { npcKey: string }
  | { decorKey: string; gdKey?: Geomorph.GmDoorKey }
  | { gdKey: Geomorph.GmDoorKey };

/** Where a menu was opened by a press: the world point, and on an npc their part */
type Pressed = { point: THREE.Vector3Like; part?: string };

/** An open menu */
type Entry = {
  menuKey: string;
  target: PickMenuTarget;
  /** Where it was pressed to open it: in that bone's frame on an npc, else in the world */
  picked: null | { part: null | string; local: THREE.Vector3 };
  /** Opened by a press: its Cancel goes under it */
  atPointer: boolean;
  /** Bumped by `touch`: it renders again only then */
  version: number;
  /** Pixels from its anchor its Cancel is, fixed on its first frame. Until dragged */
  offset: null | Geom.VectJson;
  /** Pixels from its anchor to where its lines meet it, once dragged. Turning the World keeps them */
  dragged: null | Geom.VectJson;
  /** Where its lines meet it, as a share of its width and height, once dragged */
  pin: null | Geom.VectJson;
  /** Its anchor, and its own box, as last placed in overlay pixels */
  at: null | Geom.VectJson;
  rect: null | Geom.RectJson;
  /** Its size, and its Cancel's centre within it, as last measured on a resize */
  size: null | { width: number; height: number; cx: number; cy: number };
  /** Where a drag of its grip began, and its box then */
  drag: null | { x: number; y: number; rect: Geom.RectJson };
  el: null | HTMLDivElement;
  cancelEl: null | HTMLButtonElement;
  /** Its origin's marks: a dot on its anchor, and the lines to it */
  originEl: null | HTMLDivElement;
  /** Ends its `settle` */
  settleId: number;
  /** Desktop: take the focus once mounted, e.g. having just opened */
  wantsFocus: boolean;
};

export type State = {
  /** The canvas and this overlay, as last measured on a resize */
  boxes: OverlayBounds;
  el: null | HTMLDivElement;
  /** By menu key, in the order opened: the last is in front */
  menus: Map<string, Entry>;
  /** Measures each menu as it resizes, so `place` reads nothing */
  observer: ResizeObserver;
  /** Fingers down anywhere over the World, by pointerId */
  touches: Set<number>;
  /** A finger down on a menu, kept for the camera should another join it */
  waiting: Map<number, PointerEvent>;
  /** The world point its menu is pinned beside, where it was pressed if so, written to `out`: `null` if it is gone */
  anchorOf(entry: Entry, out: THREE.Vector3): null | THREE.Vector3;
  close(...menuKeys: string[]): void;
  closeAll(): void;
  /** Closes the menu holding the focus: `false` if none does */
  closeFocused(): boolean;
  /** The menus `e` may change */
  concernedBy(e: JshCli.Event): string[];
  /** Starts a drag of its grip */
  dragFrom(menuKey: string, e: React.PointerEvent<HTMLElement>): void;
  /** Moves it by the drag so far */
  dragTo(menuKey: string, e: React.PointerEvent<HTMLElement>): void;
  /** How shown `target` is, by its room's fade */
  fadeOf(target: PickMenuTarget): number;
  measure(entry: Entry): void;
  onResize(items: ResizeObserverEntry[]): void;
  /** A finger down over the World. Joining another, any on a menu go to the camera, so they pinch */
  onTouchDown(e: PointerEvent): void;
  onTouchUp(e: PointerEvent): void;
  /** Opens `target`'s menu, or brings it to the front placed afresh. `pressed`: there, its Cancel under the press */
  open(target: PickMenuTarget, pressed?: Pressed): void;
  /** Each frame: pins each menu beside its anchor, faded with its room */
  place(): void;
  /** Marks where `entry` is pinned: a dot at `at`, and axis-aligned lines to `to`, where they meet it */
  placeOrigin(entry: Entry, at: Geom.VectJson, to: Geom.VectJson, opacity: string): void;
  /** Screen pixels a metre spans at `target`'s anchor, as the camera is now */
  pxPerMetre(entry: Entry): number;
  /** `pressed` as an anchor: on an npc, in the frame of the bone pressed */
  pickedOf(target: PickMenuTarget, pressed: Pressed): Entry["picked"];
  /** Back beside its anchor, e.g. on a double click of its grip */
  resetOffset(menuKey: string): void;
  setCollapsed(menuKey: string, next?: boolean): void;
  /** Eases it and its marks into place for `settleMs`, e.g. having collapsed */
  settle(entry: Entry): void;
  toggle(target: PickMenuTarget): void;
  /** Renders these menus again */
  touch(...menuKeys: string[]): void;
};
