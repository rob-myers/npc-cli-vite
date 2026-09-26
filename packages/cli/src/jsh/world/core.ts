import { npcDims } from "@npc-cli/ui__world/const.both";
import { agentConfig, standConfig } from "@npc-cli/ui__world/const.npc";
import { Vect } from "@npc-cli/util/geom";
import { isStringInt, keys } from "@npc-cli/util/legacy/generic";
import { awaitPausable, isPaused, npcQuery, plan, request } from "./plan.main";
import { padded, parked } from "./pred";

/**
 * Face a point, tracked, or a world angle, moving or not: moves strafe whilst set — see `npc.anim.face.aim`.
 * A bare `aim rob` clears it. Piped, each pick re-aims them until killed, and picking them clears it
 * ```sh
 * aim rob at:$( pick 1 )
 * aim rob at:1.57
 * aim rob at:kate rate:0.5
 * aim rob
 * pick --right | aim rob
 * ```
 */
export async function aim(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey: string; at?: number | string | JshCli.PointAnyFormat; rate?: number } = api.jsArg(args, {
    npc: "npcKey",
  }),
) {
  opts.npcKey ??= getFirstUnknownNaked(opts) as string;
  const npc = w.npc.get(opts.npcKey);
  const aimAt = (at?: number | string | MaybeMeta<JshCli.PointAnyFormat>) => {
    const to = typeof at === "string" ? w.e.getPoint(at) : at; // another npc as they stand now
    const self = typeof to === "object" && to.meta?.npcKey === npc.key;
    const { face } = npc.anim;
    if (to === undefined || self) return void (face.aim = null); // picking or naming them clears it
    face.aim = {
      at: typeof to === "number" ? to : w.helper.parseGroundPoint(to),
      rate: opts.rate ?? 1,
      untilRest: false,
    };
  };
  if (api.isTtyAt(0)) return aimAt(opts.at);

  let onKill = () => {};
  const killed = new Promise<never>((_, reject) => (onKill = () => reject(api.getKillError()))); // a read may never come
  const handlers = api.handleStatus({ cleanup: () => (aimAt(), onKill()) });
  try {
    while (true) {
      const datum = await Promise.race([api.read(), killed]);
      if (datum === api.eof) break;
      aimAt(datum);
    }
  } finally {
    handlers.dispose();
  }
}

/**
 * Get at most one decor containing a given point.
 * Accounts for height e.g. bunk beds.
 * - opts
 * ```sh
 * at [1.5,4.5]
 * at point:[1.5,4.5]
 * at point:[1.5,2,4.5]
 * at [1.5,4.5]
 * at $( pick 1 )
 * at $( pick 1 as:point )
 * ```
 */
export async function at(
  { api, args, w }: JshCli.RunArg<JshCli.PointAnyFormat>,
  // force so can `at $( pick 1 )` sans throw
  opts: { point?: JshCli.PointAnyFormat } = api.jsArg(args, undefined, { force: true }),
) {
  const point = opts.point ?? api.parseJsArg(args[0]);

  if (!w.helper.isPointAnyFormat(point)) {
    throw Error("expected point");
  }

  const groundPoint = w.helper.parseGroundPoint(point);

  const results = w.decor.queryPoint(groundPoint, {
    restrictByHeight: w.helper.parse3dHeight(point) ?? npcDims.height / 2,
    radius: 1.5 / 2,
  });

  return results[0];
}

export async function* awaitWorld({ api, home: { WORLD_KEY } }: JshCli.RunArg) {
  if (typeof WORLD_KEY !== "string") {
    throw Error("WORLD_KEY not a string");
  }

  yield `${api.ansi.Cyan}awaiting ${api.ansi.White}${WORLD_KEY}`;

  while (api.getCached(WORLD_KEY)?.isReady(api.meta.sessionKey) !== true) {
    await api.sleep(0.05);
  }

  // world commands pause with it — see `docs/jsh-pause.md`
  api.setPtags({ world: false });
  const w = api.getCached(WORLD_KEY);
  const group = api.pauseGroup("world");
  const sub = w.events.subscribe({
    next: (e) => (e.key === "disabled" ? group.pause() : e.key === "enabled" && group.resume()),
  });
  group.own(() => sub.unsubscribe());
  if (w.disabled === true) group.pause();
}

/**
 * ```sh
 * close g0d29 g0d30
 * close door:g0d30
 * close doors:['g0d29','g0d30']
 * ```
 */
export function close(
  ct: JshCli.RunArg,
  opts: { all?: boolean; door?: Geomorph.GmDoorKey; doors?: Geomorph.GmDoorKey[] } = ct.api.jsArg(ct.args),
) {
  doorAction(ct, "close", opts);
}

function doorAction(
  ct: JshCli.RunArg,
  act: "open" | "close" | "lock" | "unlock",
  opts: { all?: boolean; door?: Geomorph.GmDoorKey; doors?: Geomorph.GmDoorKey[] } = ct.api.jsArg(ct.args),
) {
  const { w, api, args } = ct;

  const inputs =
    opts.all === true
      ? keys(w.door.byKey)
      : [...(opts.doors ?? []).concat(opts.door ?? []), ...api.getJsOperands(args, opts)];

  for (const gdKey of inputs) {
    if (!w.helper.isGmDoorKey(gdKey)) {
      throw Error(`invalid gdKey: ${gdKey}`);
    }
    // biome-ignore format: succinct
    switch (act) {
      case 'open': w.e.toggleDoor(gdKey, { open: true }); break;
      case 'close': w.e.toggleDoor(gdKey, { close: true });break;
      case 'lock': w.e.toggleLock(gdKey, { lock: true }); break;
      case 'unlock': w.e.toggleLock(gdKey, { unlock: true }); break;
    }
  }

  w.view.forceUpdate();
}

/**
 * Examples:
 * ```sh
 * events
 * events | filter /picked/
 * events /picked/
 * events 'e => e.key === "picked"'
 * events where:'e => e.key === "picked"'
 * events /-collider/ | map meta
 * ```
 */
export async function* events<T extends JshCli.Event = JshCli.Event>(
  { api, args, w }: JshCli.RunArg,
  opts: { where?(e: JshCli.Event): e is T } = api.jsArg(args),
) {
  api.setPtags({ world: false }); // it reports the pause
  const filter = opts.where ?? (args[0] ? api.generateSelector(api.parseFnOrStr(args[0]), []) : undefined);
  const asyncIterable = api.observableToAsyncIterable(w.events);
  const handlers = api.handleStatus({
    cleanup() {
      asyncIterable.return?.();
    },
  });

  for await (const event of asyncIterable) {
    if (filter === undefined || filter(event)) {
      yield event as T;
    }
  }
  // get here via ctrl-c or `kill`
  handlers.dispose();
  throw api.getKillError();
}

/**
 * ```sh
 * grant npc:rob g0d29
 * grant npc:rob g0d{0..5}
 * grant npc:rob all
 * ```
 */
export function grant(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey: string; all?: boolean; doors?: Geomorph.GmDoorKey[] } = api.jsArg(args, { npc: "npcKey" }),
) {
  const operands = api.getJsOperands(args, opts);
  const gdKeys = opts.all === true ? keys(w.door.byKey) : (opts.doors ?? operands);

  const npc = w.npc.get(opts.npcKey);
  const entry = (w.e.npcToAccess[npc.key] ??= {});
  for (const gdKey of gdKeys) {
    if (w.helper.isGmDoorKey(gdKey)) entry[gdKey] = true;
    else throw Error(`invalid gdKey: ${gdKey}`);
  }
}

/**
 * The "name" of an instanceof Error is `e.message`.
 * A named error is either ignored (false) or handled, else rethrown.
 */
function handleNamedErrors(handlers: NamedErrorHandlers = {}) {
  return (e: any) => {
    const handler = e instanceof Error ? handlers[e.message] : undefined;
    if (handler === undefined) {
      throw e;
    }
    return handler === false ? undefined : handler();
  };
}

/**
 * ```sh
 * label npc:rob color:#33f
 * label npc:rob
 * ```
 */
export function label(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey: string } & Partial<JshCli.NpcLabelStyle> = api.jsArg(args, { npc: "npcKey" }),
) {
  const npc = w.npc.get(opts.npcKey);
  npc.labelStyle.color = opts.color ?? "#fff7";
  npc.labelStyle.speaking = opts.speaking ?? false;
  npc.drawLabel();
  w.view.forceUpdate();
}

/**
 * ```sh
 * lock g0d29 g0d30
 * lock $( pick 3 as:meta.gdKey )
 * lock door:g0d30
 * lock doors:'["g0d29","g0d30"]'
 * lock doors:$( pick 3 as:meta.gdKey | sponge )
 * ```
 *
 * NOTE `pick | lock` unsupported because lock/unlock would toggle under debug option "toggle doors"
 */
export function lock(
  ct: JshCli.RunArg,
  opts: { all?: boolean; door?: Geomorph.GmDoorKey; doors?: Geomorph.GmDoorKey[] } = ct.api.jsArg(ct.args),
) {
  doorAction(ct, "lock", opts);
}

/**
 * ```sh
 * look npc:rob at:$( pick 1 )
 * look rob at:$( pick 1 )
 * pick | look npc:rob
 * look npc:rob at:kate
 * ```
 */
export async function look(
  ct: JshCli.RunArg,
  opts: { npcKey: string; at: string | JshCli.PointAnyFormat; force?: boolean } = ct.api.jsArg(ct.args, {
    npc: "npcKey",
    to: "at",
    face: "at",
    "--force": "force",
  }),
) {
  opts.npcKey ??= getFirstUnknownNaked(opts) as string;
  const { pendingLooks, processHandled, lookPausable } = lookHandling(ct, {
    npcKey: opts.npcKey,
    force: opts.force,
  });

  try {
    let next: undefined | (typeof pendingLooks)[number];
    const { api } = ct;

    if (api.isTtyAt(0)) {
      pendingLooks.push(opts.at);

      while ((next = pendingLooks.shift())) {
        await lookPausable({ at: next });
      }
    } else {
      let pendingRead = api.read();

      while ((next = pendingLooks.shift() ?? (await pendingRead)) !== api.eof && next) {
        const lookPromise = lookPausable({ at: next });
        await Promise.race([lookPromise, (pendingRead = api.read())]);
      }
    }
  } finally {
    processHandled.dispose();
  }
}

function lookHandling({ api, w }: JshCli.RunArg, opts: { npcKey: string; force?: boolean }) {
  const getNpcOrUndefined = (): undefined | JshCli.Npc =>
    w.n[opts.npcKey in w.n ? opts.npcKey : api.get(opts.npcKey, true)];

  function getNpcOrThrow() {
    try {
      return w.npc.get(opts.npcKey in w.n ? opts.npcKey : api.get(opts.npcKey));
    } catch {
      throw Error(`npc not found: ${opts.npcKey}`);
    }
  }

  // npcKey or point
  const pendingLooks: (string | JshCli.PointAnyFormat)[] = [];

  return {
    pendingLooks,
    getNpcOrUndefined,
    getNpcOrThrow,
    async lookPausable(lookOpts: JshCli.LookOpts, extra?: NamedErrorHandlers) {
      if (!(typeof lookOpts.at === "string" || w.helper.isPointAnyFormat(lookOpts.at))) {
        throw Error("lookOpts.at must be a string or point");
      }

      await getNpcOrThrow()
        .look(lookOpts)
        .catch(handleNamedErrors({ paused: () => api.awaitResume(), ...extra }))
        .catch((e) => {
          if (opts.force && !(e instanceof Error && e.message === "killed")) return;
          throw e;
        });
    },
    processHandled: api.handleStatus({
      cleanup(killed) {
        killed && getNpcOrUndefined()?.rejectAll(new Error("killed"));
      },
      onSuspend: () => {
        const npc = getNpcOrUndefined();
        if (!npc || w.disabled === true) {
          return true; // a paused world holds the look itself: undone and redone, the pose would jump
        }
        pendingLooks.unshift({ ...npc.last.look });
        npc.rejectAll(Error("paused"));
        return true;
      },
    }),
  };
}

/**
 * Generic machinary for pause/resume move.
 * - `npcKey` is a literal string or a path to a literal string relative to CWD.
 */
function moveHandling({ api, w }: JshCli.RunArg, opts: { npcKey: string; force?: boolean }) {
  const getNpcOrUndefined = (): undefined | JshCli.Npc =>
    w.n[opts.npcKey in w.n ? opts.npcKey : api.get(opts.npcKey, true)];

  function getNpcOrThrow() {
    try {
      return w.npc.get(opts.npcKey in w.n ? opts.npcKey : api.get(opts.npcKey));
    } catch {
      throw Error(`npc not found: ${opts.npcKey}`);
    }
  }

  const pendingMoves: JshCli.PointAnyFormat[] = [];

  return {
    pendingMoves,
    getNpcOrUndefined,
    getNpcOrThrow,
    /** Move, handling named errors and any pause the move deferred */
    async movePausable(moveOpts: JshCli.MoveOpts, extra?: NamedErrorHandlers) {
      await w.npc
        .move(moveOpts)
        .catch(handleNamedErrors({ paused: () => api.awaitResume(), ...extra }))
        .catch((e) => {
          if (opts.force && !(e instanceof Error && e.message === "killed")) return;
          throw e;
        });
      // needed in case we allowed fade to complete
      await api.awaitResume();
    },
    processHandled: api.handleStatus({
      cleanup(killed) {
        killed && getNpcOrUndefined()?.rejectAll(new Error("killed"));
      },
      onSuspend: () => {
        const npc = getNpcOrUndefined();
        if (!npc || w.disabled === true) {
          return true; // a paused world holds the move itself: undone and redone, the walk would jump
        }

        // fadeSpawn must complete
        if (npc.isFading()) {
          return true;
        }

        if (npc.isMoving()) {
          pendingMoves.unshift({ ...npc.last.dst });
        } else if (npc.isLooking()) {
          // pendingLooks.unshift({ ...npc.last.look });
          pendingMoves.unshift({ ...npc.last.dst });
        }
        npc.rejectAll(Error("paused"));
        return true;
      },
    }),
  };
}

type NamedErrorHandlers = Record<string, false | (() => void | Promise<void>)>;

/**
 * Usage
 * ```sh
 * move npc:rob to:$( pick 1 )
 * move npc:rob to:$( pick 3 )
 *
 * move rob to:$( pick 1 )
 * move rob --back to:$( pick 1 )
 * move rob --strafe to:$( pick 1 )
 * # back up to nearby targets
 * move rob --backstep to:$( pick 1 )
 *
 * # move immediately
 * pick | move npc:rob
 *
 * # move along picked path
 * pick | move npc:rob along
 *
 * move rob to:$( pick 1 ) facing:$( pick 1 )
 * move rob --fast to:$( pick 1 )
 * ```
 */
export async function move(
  ct: JshCli.RunArg,
  opts: Omit<JshCli.MoveOpts, "to"> & {
    to?: JshCli.PointAnyFormat | JshCli.PointAnyFormat[];
    along?: boolean;
    force?: boolean;
  } = ct.api.jsArg(ct.args, {
    npc: "npcKey",
    "--fast": "fast",
    "--force": "force",
    "--backwards": "backwards",
    "--back": "backwards",
    "--strafe": "strafe",
    "--backstep": "backstep",
  }),
) {
  if (!opts.to && ct.api.isTtyAt(0)) {
    throw Error("opts.to required when not piping");
  }
  // undefined will throw later
  opts.npcKey ??= getFirstUnknownNaked(opts) as string;

  if (opts.to) {
    await move_const(ct, { ...opts, to: opts.to });
  } else if (!opts.along) {
    await move_next(ct, opts);
  } else {
    await move_lazy(ct, opts);
  }
}

/**
 * move to point or smoothly along points
 * e.g. `move npc:rob to:$( pick 3 )`
 */
async function move_const(
  ct: JshCli.RunArg,
  opts: Omit<JshCli.MoveOpts, "to"> & {
    to: JshCli.PointAnyFormat | JshCli.PointAnyFormat[];
    force?: boolean;
  } = ct.api.jsArg(ct.args, { npc: "npcKey" }),
) {
  const fixedPoints = isArrayOfPoints(opts.to) ? opts.to : [opts.to];

  const { getNpcOrThrow, pendingMoves, processHandled, movePausable } = moveHandling(ct, {
    npcKey: opts.npcKey,
    force: opts.force,
  });

  try {
    pendingMoves.push(...fixedPoints);
    let next: undefined | JshCli.PointAnyFormat;

    while ((next = pendingMoves.shift())) {
      await movePausable({
        ...moveFlags(opts),
        npcKey: getNpcOrThrow().key,
        to: next,
        arrive: pendingMoves.length === 0,
      });
    }
  } finally {
    processHandled.dispose();
  }
}

/**
 * move smoothly along lazily supplied path
 * e.g. `pick | move npc:rob along`
 */
async function move_lazy(
  ct: JshCli.RunArg,
  opts: Omit<JshCli.MoveOpts, "to"> & {
    force?: boolean;
  } = ct.api.jsArg(ct.args, { npc: "npcKey" }),
) {
  const { api, w } = ct;

  const { getNpcOrThrow, pendingMoves, processHandled, movePausable } = moveHandling(ct, {
    npcKey: opts.npcKey,
    force: opts.force,
  });

  let pendingRead = api.read();

  try {
    while (true) {
      const readNext = pendingMoves.length === 0;
      const dst = pendingMoves.shift() ?? (await pendingRead);
      if (dst === api.eof) break;
      if (readNext) pendingRead = api.read();

      const npc = getNpcOrThrow();

      const movePromise = movePausable(
        { ...moveFlags(opts), npcKey: npc.key, to: dst },
        {
          "not navigable": false,
          stuck: () => {
            pendingMoves.length = 0;
            api.flush();
          },
        },
      );

      // glide through destination if next step is a navigation
      await Promise.race([
        movePromise,
        pendingRead.then((next) => next !== api.eof && !w.npc.hasDoMeta(next?.meta ?? {}) && npc.preventArrival()),
      ]);
      await movePromise;
    }
  } finally {
    processHandled.dispose();
  }
}

/**
 * move immediately to latest destination
 * e.g. `pick | move npc:rob`
 */
async function move_next(
  ct: JshCli.RunArg,
  opts: Omit<JshCli.MoveOpts, "to"> & {
    force?: boolean;
  } = ct.api.jsArg(ct.args, { npc: "npcKey" }),
) {
  const { api } = ct;

  const { getNpcOrThrow, pendingMoves, processHandled, movePausable } = moveHandling(ct, {
    npcKey: opts.npcKey,
    force: opts.force,
  });

  try {
    let pendingRead = api.read();
    let next: undefined | JshCli.PointAnyFormat;

    while ((next = pendingMoves.shift() ?? (await pendingRead)) !== api.eof && next) {
      const npc = getNpcOrThrow();
      const movePromise = movePausable(
        { ...moveFlags(opts), npcKey: npc.key, to: next },
        { "not navigable": false, occupied: false, stuck: false },
      );
      await Promise.race([movePromise, (pendingRead = api.read())]);
    }
  } finally {
    processHandled.dispose();
  }
}

/**
 * ```sh
 * nudge npc:kate
 * nudge kate
 * nudge npc:kate from:rob
 * nudge npc:kate from:$( pick 1 ) by:1
 * ```
 */
export async function nudge(
  ct: JshCli.RunArg,
  opts: { npcKey?: string; from?: string | JshCli.PointAnyFormat; by?: number } = ct.api.jsArg(ct.args, {
    npc: "npcKey",
    src: "from",
  }),
) {
  opts.npcKey ??= getFirstUnknownNaked(opts) as string;
  opts.by ??= 0.5;

  const { w, api } = ct;
  const npc = w.npc.get(opts.npcKey);

  if (!opts.from) {
    // nudge from a random angle
    const angle = Math.random() * Math.PI * 2;
    opts.from = { x: npc.point.x + opts.by * Math.cos(angle), y: npc.point.y + opts.by * Math.sin(angle) };
  }

  if (typeof opts.from === "string") {
    opts.from = w.npc.get(opts.from).point;
  }

  const src = npc.point;
  const delta = Vect.from(src).sub(w.helper.parseGroundPoint(opts.from)).normalize(opts.by);

  // slid along the navmesh, so a nudge into a wall (or a door they cannot pass) stops at it
  const to = await plan({
    api,
    w,
    op: { key: "nudge", npc: npcQuery(w, npc), to: { x: src.x + delta.x, y: src.y + delta.y } },
  });
  if (to === null || Math.hypot(to.x - src.x, to.y - src.y) < nudgeMinMove) {
    return; // nowhere to go i.e. backed against something
  }

  await w.npc.move({ npcKey: npc.key, to });
}

/** Below this much of a clamped nudge, we do not move at all */
const nudgeMinMove = 0.05;

/**
 * ```sh
 * open g0d29 g0d30
 * open door:g0d29
 * open doors:['g0d29','g0d30']
 * ```
 */
export function open(
  ct: JshCli.RunArg,
  opts: { all?: boolean; door?: Geomorph.GmDoorKey; doors?: Geomorph.GmDoorKey[] } = ct.api.jsArg(ct.args),
) {
  doorAction(ct, "open", opts);
}

/**
 * Stand npcs where there is room to walk right round them: `by` (default `standConfig.padClearance`) from
 * their room's walls and doorways, and from everyone else standing in it — the spot is remembered
 * in `/shared/pred`. Planned together on the worker, then everyone with a spot fades into place at
 * once; one without is left where they stand and named in the error
 * ```sh
 * pad kate
 * pad kate rob
 * pad kate by:1
 * ```
 */
export async function pad(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey?: string; npcKeys?: string[]; by?: number } = api.jsArg(args, { npc: "npcKey" }),
) {
  // ignore non-existent npcKey including e.g. npc:foo
  const npcs = [opts.npcKey ?? [], opts.npcKeys ?? [], args].flat().flatMap((npcKey) => w.n[npcKey] ?? []);

  // everyone stood in the rooms we are padding — a spot on top of any of them is no spot at all.
  // Keyed, so a room shared by two of them is only sent once; the worker drops those being padded
  const others = new Map(
    npcs.flatMap((npc) => {
      const at = w.e.npcToRoom.get(npc.key);
      if (at === undefined) return [];
      return [...(w.e.roomToNpcs[at.gmId]?.[at.roomId] ?? [])].flatMap((key) => {
        const point = w.n[key]?.point;
        return point === undefined ? [] : [[key, { key, point, grKey: at.grKey }] as const];
      });
    }),
  );

  await awaitPausable(api, async (signal) => {
    const plans = await request(
      w,
      api,
      {
        key: "pad",
        npcs: npcs.map((npc) => npcQuery(w, npc)),
        others: [...others.values()],
        by: opts.by ?? standConfig.padClearance,
      },
      signal,
    );
    const leftOut = npcs.filter((_, i) => plans[i] === null);

    // a kill stops them where they are; a pause does not — see `awaitPausable`
    const onAbort = () => isPaused(signal.reason) === false && npcs.forEach((npc) => npc.rejectAll(signal.reason));
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await Promise.all(
        npcs.map(async (npc, i) => {
          const plan = plans[i];
          if (plan === null) return;
          if (Math.hypot(plan.at.x - npc.point.x, plan.at.y - npc.point.y) > standConfig.parkMinMove) {
            await npc.fadeSpawn({ at: plan.at, angle: npc.rotation.y }); // facing as they were
          }
          padded.mark(npc.key);
        }),
      );
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    if (leftOut.length > 0) throw Error(`not padded: ${leftOut.map((npc) => npc.key).join(" ")}`);
  });
}

/**
 * Stand npcs against a nearby wall, out of the way: clear of its corners, the room's doorways and its other
 * parked npcs, and remembered in `/shared/pred` — see `pred.ts`. Planned together on the worker, then everyone
 * moves at once — bar one with no clear spot, left where they stand and named in the error.
 * A kill rejects the npcs; a pause lets a fade or look finish
 * ```sh
 * park npc:kate
 * park kate
 * park kate rob
 * ```
 */
export async function park(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey?: string; npcKeys?: string[] } = api.jsArg(args, { npc: "npcKey" }),
) {
  // ignore non-existent npcKey including e.g. npc:foo
  const npcs = [opts.npcKey ?? [], opts.npcKeys ?? [], args].flat().flatMap((npcKey) => w.n[npcKey] ?? []);

  await awaitPausable(api, async (signal) => {
    const plans = await request(
      w,
      api,
      {
        key: "park",
        npcs: npcs.map((npc) => npcQuery(w, npc)),
        // everyone parked, wherever: a handful, and the worker keeps to the rooms involved
        parked: [...parked.get()].flatMap(([key, seg]) => {
          const grKey = w.e.npcToRoom.get(key)?.grKey;
          const point = w.n[key]?.point; // persisted: they may not be here this time
          return grKey === undefined || point === undefined ? [] : [{ key, point, grKey, seg }];
        }),
      },
      signal,
    );
    // no wall in reach, or no clear spot on any: left where they stand, and named once the rest are parked
    const leftOut = npcs.filter((_, i) => plans[i] === null);

    // a kill stops them where they are; a pause does not — see `awaitPausable`
    const onAbort = () => isPaused(signal.reason) === false && npcs.forEach((npc) => npc.rejectAll(signal.reason));
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await Promise.all(
        npcs.map(async (npc, i) => {
          const plan = plans[i];
          if (plan === null) return;
          const { at, facing, seg } = plan;
          if (Math.hypot(at.x - npc.point.x, at.y - npc.point.y) > standConfig.parkMinMove) {
            await npc.fadeSpawn({ at, facing });
          } else {
            await npc.look({ at: facing });
          }

          parked.mark(npc.key, seg);
        }),
      );
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    if (leftOut.length > 0) throw Error(`not parked: ${leftOut.map((npc) => npc.key).join(" ")}`);
  });
}

export function pause({ api, w }: JshCli.RunArg) {
  api.setPtags({ world: false }); // else it pauses itself
  w.setDisabled(true);
}

/**
 * ```sh
 * pick
 * pick 1
 * pick meta.floor
 * pick meta.ceiling
 * pick meta.wall # maybe `config pickWalls true` first
 * pick | map meta.type
 * pick '({ meta }, ct) => meta.type === "floor" && ct.home.foo == 42'
 * pick as:meta.type
 * pick as:point
 * w npc.spawn "{ npcKey: 'rob', at: $( pick 1 ) }"
 * spawn npc:rob at:$( pick 1 )
 *
 * # multiple filters act as OR
 * pick meta.{nav,do}
 *
 * pick --long
 * ```
 *
 * Priority:
 * - given `pick m` and `pick n` execution order wins
 * - given two `pick`s execution order wins
 * - `pick m` always executes before `pick`
 * - on execute `pick m --fifo` it defers priority
 */
export async function* pick(ct: JshCli.RunArg) {
  const { args, api, w } = ct;
  api.setPtags({ world: false }); // picking whilst paused

  // e.g. `pick --long` not `pick long` (filter)
  const opts = ct.api.jsArg(args, {
    "--left": "left", // left clicks only
    "--right": "right", // right clicks only
    "--long": "long", // long press only
    "--any": "any", // left or right permitted
    "--fifo": "fifo", // default lifo: new picks take priority over old ones
  });
  const operands = ct.api.getJsOperands(args, opts);

  if (opts.right !== true && opts.any !== true) {
    opts.left = true; // default to left clicks only
  }
  opts.long ??= false;

  // if (!isStringInt(operands[0]) && isStringInt(operands[1])) {
  //   // support reverse order `pick meta.nav 2`
  //   operands = [operands[1], operands[0]];
  // }
  const lastNumericOperand = operands.findLast(isStringInt);
  const hasNumericOperand = lastNumericOperand !== undefined;
  // operands = operands.filter(x => !isStringInt(x));
  // const explicitNumPicks = isStringInt(operands[0]) ? parseInt(operands[0], 10) : undefined;
  const explicitNumPicks = hasNumericOperand ? parseInt(lastNumericOperand, 10) : undefined;
  const maxExplicitPicks = 1024;

  /** Number of picks remaining */
  let numPicks = explicitNumPicks ?? Number.MAX_SAFE_INTEGER;
  if (explicitNumPicks !== undefined && explicitNumPicks > maxExplicitPicks) {
    numPicks = maxExplicitPicks;
    api.writeError(`${api.ansi.Yellow}warn: max explicit picks is ${maxExplicitPicks}`);
  }

  const lifo = opts.fifo !== true;
  const clickId = hasNumericOperand ? api.getUid() : undefined;

  // support `pick meta.floor`
  // support `pick '({ meta }, ct) => meta.type === "floor"'`
  const filters = operands
    .filter((x) => !isStringInt(x) && !x.startsWith("as:"))
    .map((filterDef) => api.generateSelector(api.parseFnOrStr(filterDef), [ct]));

  // support jsArg as:foo.bar.baz (apply selector)
  // const jsOpts = api.jsArg(args) as { as?: string };
  const selector = opts.as ? api.generateSelector(api.parseFnOrStr(opts.as)) : undefined;

  let eventsSub: import("@npc-cli/util").BasicSubscription;

  // suspend/resume handled by `api.isRunning()` below
  const handlers = api.handleStatus({
    cleanup() {
      w.view.clickIds = w.view.clickIds.filter(({ id }) => id !== clickId);
      eventsSub?.unsubscribe();
    },
  });

  try {
    if (clickId !== undefined && lifo === false && numPicks <= maxExplicitPicks) {
      // e.g. `pick 2` but not `pick 2 --fifo`
      w.view.clickIds.push(...Array.from({ length: numPicks }, () => ({ id: clickId, blocking: false })));
    }

    while (numPicks > 0) {
      if (clickId !== undefined && lifo === true) {
        // `pick 5` but not `pick 5 --fifo`
        w.view.clickIds.unshift({ id: clickId, blocking: true });
      }
      const output = await new Promise<JshCli.PickEvent>((resolve, reject) => {
        eventsSub = w.events.subscribe({
          next(e) {
            if (e.key !== "picked") {
              return;
            } else if (api.isRunning() === false) {
              return;
            } else if (e.clickId !== undefined && clickId === undefined) {
              return; // `pick {n}` overrides `pick`
            } else if (e.clickId !== undefined && clickId !== e.clickId) {
              return; // ignore other picks (possibly started after this one)
            }

            resolve(e); // Must resolve before tear-down induced by unsubscribe
            eventsSub.unsubscribe();
          },
        });
        eventsSub.add(() => reject(api.getKillError()));
      });

      if (
        (opts.left === true && output.rightDown === true) ||
        (opts.right === true && output.rightDown === false) ||
        opts.long !== output.longDown
      ) {
        continue;
      }

      if (filters.length === 0 || filters.some((filter) => filter(output))) {
        numPicks--;
        yield selector ? selector(output) : output;
      } else if (clickId !== undefined && lifo === false) {
        // - need to ignore this pick
        // - we'll put incoming blocking before current
        w.view.clickIds = w.view.clickIds
          .filter(({ blocking }) => blocking)
          .concat(
            { id: clickId, blocking: false },
            w.view.clickIds.filter(({ blocking }) => !blocking),
          );
      }
    }
  } finally {
    handlers.dispose();
  }
}

export function play({ api, w }: JshCli.RunArg) {
  api.setPtags({ world: false }); // else it starts paused
  w.setDisabled(false);
}

/**
 * Test if ray hits walls or closed doors.
 * - Point via `ray point`
 * - Detail via `ray detail`
 * ```sh
 * ray from:$( pick 1 ) to:$( pick 1 )
 * ray from:kate to:will
 * ray point from:kate to:will
 * ray detail from:kate to:will
 * ray detail src:rob dst:$( pick 1 )
 * ```
 */
export async function ray(
  { api, args, w }: JshCli.RunArg,
  opts: {
    src: JshCli.PointAnyFormat | string;
    dst: JshCli.PointAnyFormat | string;
    /** Output point. */
    point?: boolean;
    /** Output detailed result. */
    detail?: boolean;
  } = api.jsArg(args, { from: "src", to: "dst" }),
) {
  const src = typeof opts.src === "string" ? w.e.getPoint(opts.src) : opts.src;
  const dst = typeof opts.dst === "string" ? w.e.getPoint(opts.dst) : opts.dst;
  const result = await w.e.raycast(src, dst);
  if (opts.point === true) {
    return result.hit;
  } else if (opts.detail === true) {
    return result;
  } else {
    return result.hit === null;
  }
}

/**
 * Put a coloured ring round an npc, or take it away
 * ```sh
 * ring npc:rob color:#33f
 * ring npc:rob
 * ```
 */
export function ring(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey: string; color?: string } = api.jsArg(args, { npc: "npcKey" }),
) {
  w.npc.get(opts.npcKey ?? args[0]).setRing(opts.color);
}

/**
 * remove npc(s) or runtime decor, assuming no name collisions
 *
 * This is an example of a function we wouldn't invoke via JS.
 * Instead we would use `w.e.removeNpcs` or `w.decor.remove`.
 *
 * Implicitly we're assuming npcKeys and runtime decorKeys
 * are disjoint, as are the literals "npcs" and "decor".
 *
 * ```sh
 * # remove all npcs
 * remove npcs
 * # remove all runtime decor
 * remove decor
 * # remove specified npcs
 * remove rob kate
 * # remove runtime decor and an npc
 * remove test-decor-point will
 *
 * remove npc:rob
 * remove npcs:'["rob',"kate"]'
 * ```
 */
export async function remove(
  { w, api, args }: JshCli.RunArg,
  opts: { npcKey?: string; npcKeys?: string[] } = api.jsArg(args, { npc: "npcKey" }),
) {
  if (args.length === 1) {
    if (args[0] === "npcs") {
      return w.e.removeNpcs(...Object.keys(w.n));
    } else if (args[0] === "decor") {
      return w.decor.remove(...Object.keys(w.decor.runtime.byKey));
    } else if (typeof opts.npcKey === "string") {
      return w.e.removeNpcs(opts.npcKey);
    } else if (Array.isArray(opts.npcKeys)) {
      return w.e.removeNpcs(...opts.npcKeys);
    }
  }

  const npcKeys = args.filter((arg) => arg in w.n);
  const runtimeDecorKeys = args.filter((arg) => arg in w.decor.runtime.byKey);
  npcKeys.length && w.e.removeNpcs(...npcKeys);
  runtimeDecorKeys.length && w.decor.remove(...runtimeDecorKeys);
  setTimeout(() => w.view.forceUpdate(0.001), 30);
}

/**
 * ```sh
 * revoke npc:rob g0d29
 * revoke npc:rob g0d{0..5}
 * revoke npc:rob all
 * ```
 */
export function revoke(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey: string; all?: boolean; doors?: Geomorph.GmDoorKey[] } = api.jsArg(args, { npc: "npcKey" }),
) {
  const operands = api.getJsOperands(args, opts);
  const gdKeys = opts.all === true ? keys(w.door.byKey) : (opts.doors ?? operands);

  const npc = w.npc.get(opts.npcKey);
  const entry = (w.e.npcToAccess[npc.key] ??= {});
  for (const gdKey of gdKeys) {
    if (w.helper.isGmDoorKey(gdKey)) entry[gdKey] = false;
    else throw Error(`invalid gdKey: ${gdKey}`);
  }
}

/**
 * ```sh
 * # say something
 * say hi npc:rob
 * say npc:rob hi
 * say hi npc:rob secs:5
 * say hi npc:rob for:10
 * say hi npc:rob for:Infinity
 * say hi rob for:1
 * ```
 */
export function say(
  { api, args, w }: JshCli.RunArg<JshCli.PointAnyFormat>,
  opts: { npcKey: string; words?: string; secs?: number } = api.jsArg(args, { npc: "npcKey", for: "secs" }),
) {
  /** support `say hi rob` where lastWord is npcKey */
  let lastWord: undefined | string;
  opts.npcKey ??= (lastWord = getLastUnknownNaked(opts)) as string;

  const npc = w.npc.get(opts.npcKey);
  const words =
    opts.words ??
    api
      .getJsOperands(args, opts)
      .slice(0, lastWord === undefined ? undefined : -1)
      .join(" ");

  if (words) {
    w.speech.say(npc.key, words, opts.secs);
  }
}

/**
 * ```sh
 * skin npc:rob medic-0
 * skin npc:rob as:medic-0
 * skin rob human-1
 * ```
 */
export function skin(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey: string; as?: string } = api.jsArg(args, { npc: "npcKey" }),
) {
  opts.npcKey ??= getFirstUnknownNaked(opts) as string;
  const npc = w.npc.get(opts.npcKey);
  const skinKey = (opts.as ??= getLastUnknownNaked(opts) ?? "robot-0");
  if (w.npc.getSkinIndexBySkinKey(skinKey) === -1) {
    throw Error(`skin "${skinKey}" not found`);
  }
  npc.setSkin(skinKey);
  w.view.forceUpdate();
}

/**
 * ```sh
 * spawn npc:foo at:[7,0,7]
 * spawn npc:rob at:$( pick 1 )
 * spawn rob at:$( pick 1 )
 *
 * # spawn multiple
 * pick | spawn npc:rob-
 *
 * spawn npc:rob at:$( pick 1 ) angle:3.14
 * spawn npc:rob at:$( pick 1 ) facing:$( pick 1 )
 *
 * # alternating (at, facing)
 * pick | spawn npc:rob- facing
 *
 * pick | spawn npc:rob-
 *
 * # ignore errors when not reading from stdin: non placable or doable
 * pick | spawn force npc:rob-
 * ```
 */
export async function spawn(
  { api, args, w, datum }: JshCli.RunArg<JshCli.PointAnyFormat>,
  opts: JshCli.SpawnOpts & { force?: boolean } = api.jsArg(args, {
    npc: "npcKey",
    to: "at",
    skin: "as",
    towards: "facing",
    look: "facing",
  }),
) {
  api.setPtags({ world: false }); // can spawn while paused

  // support e.g. `spawn rob at:$( pick 1 )`
  opts.npcKey ??= getFirstUnknownNaked(opts) ?? (api.isTtyAt(0) ? "npc" : "npc-");

  if (api.isTtyAt(0)) {
    return await w.npc.spawn(opts);
  }

  function ignoreSpawnErrors(e: unknown) {
    if (opts.force && e instanceof Error && (e.message === "not placable" || e.message === "not doable")) {
      numSpawns--;
      return;
    }
    throw e;
  }

  let numSpawns = 0;
  if (!opts.facing) {
    while ((datum = await api.read()) !== api.eof) {
      await w.npc.spawn({ ...opts, npcKey: `${opts.npcKey}${numSpawns++}`, at: datum }).catch(ignoreSpawnErrors);
    }
    return;
  }

  while (true) {
    await w.npc
      .spawn({
        ...opts,
        npcKey: `${opts.npcKey}${numSpawns++}`,
        at: await api.read(),
        facing: await api.read(),
      })
      .catch(ignoreSpawnErrors);
  }
}

/**
 * ```sh
 * unlock g0d29 g0d30
 * unlock door:g0d29
 * unlock doors:['g0d29','g0d30']
 * ```
 */
export function unlock(
  ct: JshCli.RunArg,
  opts: { all?: boolean; door?: Geomorph.GmDoorKey; doors?: Geomorph.GmDoorKey[] } = ct.api.jsArg(ct.args),
) {
  doorAction(ct, "unlock", opts);
}

/**
 * Usage:
 * ```sh
 * w
 * w key
 * w mapKey
 * w | keys
 * w npc.spawn '{ npcKey: "foo", at: [6, 0, 7.5] }'
 * w npc.spawn "{ npcKey: 'foo-bar-baz', at: $( pick 1 | map point ) }"
 * w npc.spawn "{ npcKey: 'foo-bar-baz', at: $( pick 1 ) }"
 * w door.setOpen 0 21 true
 * ```
 *
 * - can always `ctrl-c`, even without cleaning up ongoing computations
 * - can read stdin via hyphen arg
 */
export async function* w(ct: JshCli.RunArg) {
  const { api, args, w } = ct;

  // support piped inputs via hyphen args -
  // e.g. `pick 1 | w e.findRoomContaining -`
  const stdinInputChar = "-";
  const readStdin = !ct.api.isTtyAt(0) && args.slice(1).some((arg) => arg === stdinInputChar);

  let reject = (_e: any) => {};
  const handlers = api.handleStatus({
    cleanup() {
      reject(new Error("potential ongoing computation"));
    },
  });
  async function awaitOrIgnore(value: any) {
    // handle non-promise or promise
    return Promise.race([value, new Promise((_, rej) => (reject = rej))]).finally(() => {
      reject(null);
      handlers.dispose();
    });
  }

  if (readStdin !== true) {
    const func = api.generateSelector(api.parseFnOrStr(args[0]), args.slice(1).map(api.parseJsArg), true);
    yield await awaitOrIgnore(func(w, ct));
    return;
  }

  let datum: any;
  while ((datum = await api.read()) !== api.eof) {
    const func = api.generateSelector(
      api.parseFnOrStr(args[0]),
      args.slice(1).map((x) => (x === stdinInputChar ? datum : api.parseJsArg(x))),
      true,
    );
    try {
      yield awaitOrIgnore(func(w, ct));
    } catch (e) {
      yield `${api.ansi.Cyan}${e}${api.ansi.Reset}`;
    }
  }
}

/**
 * ```sh
 * warp rob to:$( pick 1 )
 * ```
 */
export async function warp(
  { w, api, args }: JshCli.RunArg,
  opts: { npcKey: string; to: MaybeMeta<JshCli.PointAnyFormat> } = api.jsArg(args, { npc: "npcKey" }),
) {
  opts.npcKey ??= getFirstUnknownNaked(opts) as string;
  const npc = w.npc.get(opts.npcKey);
  await npc.fadeSpawn({ at: opts.to });
}

/**
 * Whilst w/a/s/d are held over the World, emits a navigable target just ahead of the npc: up, left, down or right as
 * seen. None is emitted where the mesh ends — see `npc.getSlideResult`
 * ```sh
 * wasd_delta rob | move rob
 * wasd_delta rob --fast | move rob --fast
 * ```
 */
export async function* wasd_delta(
  ct: JshCli.RunArg,
  opts: { npcKey: string; fast?: boolean } = ct.api.jsArg(ct.args, { "--fast": "fast", npc: "npcKey" }),
) {
  const { api, w } = ct;
  opts.npcKey ??= getFirstUnknownNaked(opts) as string;
  const length = (opts.fast === true ? agentConfig.maxSpeed.run : agentConfig.maxSpeed.walk) * wasdConfig.stepSecs;

  while (true) {
    await api.sleep(wasdConfig.intervalSecs); // a kill rejects it
    const direction = w.view.getWasdDirection();
    if (direction.length === 0) continue; // none held, or opposites
    const npc = w.npc.get(opts.npcKey);
    const slide = npc.getSlideResult(direction.normalize(length));
    if (slide?.success !== true || npc.distanceTo(slide.groundPoint) < wasdConfig.minMove) continue; // the mesh's edge
    yield { ...slide.groundPoint, meta: { floor: true, nav: true } };
  }
}

const wasdConfig = {
  /** Seconds between reads of the held keys */
  intervalSecs: 0.1,
  /** Seconds of travel the target sits ahead — past the next read, so they never arrive */
  stepSecs: 0.4,
  /** Metres: a clamped step shorter than this is the mesh's edge, and nothing is emitted */
  minMove: 0.05,
} as const;

/** How each move is made, as the command line gave it */
function moveFlags({ fast, backwards, backstep, strafe }: Omit<JshCli.MoveOpts, "to">) {
  return { fast, backwards, backstep, strafe };
}

function isArrayOfPoints(x: unknown): x is JshCli.PointAnyFormat[] {
  return Array.isArray(x) && typeof x[0] !== "number";
}

/**
 * @see {booleanJsOptSomewhere}
 * @param opts Parsed from command line
 */
function getFirstUnknownNaked(opts: Record<string, any>) {
  return keys(opts).find((key) => typeof opts[key] === "boolean" && !(key in booleanJsOptSomewhere));
}

/**
 * @see {booleanJsOptSomewhere}
 * @param opts Parsed from command line
 */
function getLastUnknownNaked(opts: Record<string, any>) {
  return keys(opts).findLast((key) => typeof opts[key] === "boolean" && !(key in booleanJsOptSomewhere));
}

/** Forbid certain npcKeys as bare specifiers (over approximation) */
const booleanJsOptSomewhere = {
  all: true,
  along: true,
  backstep: true,
  backwards: true,
  detail: true,
  fast: true,
  force: true,
  point: true,
  strafe: true,
};
