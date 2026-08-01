import { npcHeight } from "@npc-cli/ui__world/const";
import { Vect } from "@npc-cli/util/geom";
import { geomService } from "@npc-cli/util/geom-service";
import { isStringInt, keys } from "@npc-cli/util/legacy/generic";
import { localBoundary } from "navcat/blocks";

export async function* awaitWorld({ api, home: { WORLD_KEY } }: JshCli.RunArg) {
  if (typeof WORLD_KEY !== "string") {
    throw Error("WORLD_KEY not a string");
  }

  yield `${api.ansi.Cyan}awaiting ${api.ansi.White}${WORLD_KEY}`;

  while (api.getCached(WORLD_KEY)?.isReady(api.meta.sessionKey) !== true) {
    await api.sleep(0.05);
  }
}

export function blur({ w }: JshCli.RunArg) {
  w.npc.trackNpc();
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
  const filter = opts.where ?? (args[0] ? api.generateSelector(api.parseFnOrStr(args[0]), []) : undefined);
  const asyncIterable = api.observableToAsyncIterable(w.events);
  const handlers = api.handleStatus({
    cleanups() {
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
 * Light a single npc.
 * ```sh
 * focus npc:rob
 * ```
 */
export function focus({ api, args, w }: JshCli.RunArg, opts: { npcKey: string } = api.jsArg(args, { npc: "npcKey" })) {
  const npc = w.npc.get(opts.npcKey ?? Object.values(w.n)[0]?.key);
  w.npc.trackNpc(npc.key);
  w.view.forceUpdate();
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
 * lock doors:['g0d29','g0d30']
 * ```
 */
export async function lock(
  { api, args, w }: JshCli.RunArg,
  opts: { all?: boolean; doors?: Geomorph.GmDoorKey[] } = api.jsArg(args),
) {
  const inputs = opts.all === true ? keys(w.door.byKey) : (opts.doors ?? args);
  for (const gdKey of inputs) {
    if (w.helper.isGmDoorKey(gdKey)) w.e.toggleLock(gdKey, { lock: true });
    else throw Error(`invalid gdKey: ${gdKey}`);
  }
  w.view.forceUpdate();
}

/**
 * ```sh
 * look npc:rob at:$( pick 1 )
 * pick | look npc:rob
 * look npc:rob at:kate
 * ```
 */
export async function look(
  { api, args, w, datum }: JshCli.RunArg<string | JshCli.PointAnyFormat>,
  opts: { npcKey: string; at: string | JshCli.PointAnyFormat } = api.jsArg(args, {
    npc: "npcKey",
    to: "at",
    face: "at",
  }),
) {
  const npc = w.npc.get(opts.npcKey);

  const { dispose } = api.handleStatus({
    cleanups: (killed) => killed && npc.rejectAll(new Error("killed")),
  });

  try {
    if (api.isTtyAt(0)) {
      return await npc.look(opts.at);
    }

    while ((datum = await api.read()) !== api.eof) {
      await npc.look(datum);
    }
  } finally {
    dispose();
  }
}

/**
 * Get most-relevant (or all) decor at given world or ground point.
 * ```sh
 * meta [1.5,4.5]
 * meta at:[1.5,4.5]
 * meta all:[1.5,4.5]
 * meta at:[1.5,2,4.5]
 * ```
 */
export async function meta(
  { api, args, w, datum: _ }: JshCli.RunArg<JshCli.PointAnyFormat>,
  opts: { all?: JshCli.PointAnyFormat; at?: JshCli.PointAnyFormat; radius?: number } = api.jsArg(args),
) {
  const inputPoint = opts.all ?? opts.at ?? api.parseJsArg(api.getJsOperands(args, opts)[0]);
  if (!w.helper.isPointAnyFormat(inputPoint)) {
    throw Error("expected point");
  }

  const groundPoint = w.helper.parseGroundPoint(inputPoint);
  const radius = opts.radius ?? 1.5 / 2;

  const results = w.decor.queryPoint(groundPoint, {
    // when we don't request all, results.length ≤ 1 via closest 3D height-off-ground
    desiredHeight: !opts.all ? (w.helper.parse3dHeight(inputPoint) ?? npcHeight / 2) : undefined,
    radius,
  });

  if (opts.all) {
    return results;
  }

  return results[0];
}

/**
 * Generic machinary for pausing any look/move in progress,
 * storing the unreached target at the front of `pendings`.
 *
 * `npcKey` is a literal string or a path to a literal string relative to CWD.
 */
function moveHandlingFactory({ api, w }: JshCli.RunArg, npcKey: string) {
  const getNpcOrUndefined = (): undefined | JshCli.Npc => w.n[npcKey in w.n ? npcKey : api.get(npcKey, true)];

  function getNpcOrThrow() {
    try {
      return w.npc.get(npcKey in w.n ? npcKey : api.get(npcKey));
    } catch {
      throw Error(`npc not found: ${npcKey}`);
    }
  }

  // usually singletons or empty
  const pendingLooks: JshCli.PointAnyFormat[] = [];
  const pendingMoves: JshCli.PointAnyFormat[] = [];

  function handlePausedError(e: any) {
    if (e instanceof Error && e.message === "paused") {
      return api.awaitResume();
    }
    throw e;
  }

  return {
    pendingLooks,
    pendingMoves,
    getNpcOrUndefined,
    getNpcOrThrow,
    handleStatus: () =>
      api.handleStatus({
        cleanups(killed) {
          killed && getNpcOrUndefined()?.rejectAll(new Error("killed"));
        },
        onSuspends: () => {
          const npc = getNpcOrUndefined();
          if (!npc) {
            return true;
          }

          if (npc.isMoving()) {
            pendingMoves.unshift({ ...npc.last.dst });
          } else if (npc.isLooking()) {
            pendingLooks.unshift({ ...npc.last.look });
          }
          npc.rejectAll(Error("paused"));
          return true;
        },
      }),
    handlePausedError,
    /**
     * Awaiting a move surfaces errors the destination itself caused,
     * which shouldn't stop us reading further destinations.
     */
    handleMoveError(e: any) {
      if (e instanceof Error && ["not navigable", "occupied", "stuck"].includes(e.message)) {
        return Promise.resolve();
      }
      return handlePausedError(e);
    },
  };
}

/**
 * Usage
 * ```sh
 * move npc:rob to:$( pick 1 )
 * move npc:rob to:$( pick 3 )
 *
 * # move immediately
 * pick | move npc:rob
 *
 * # move along picked path
 * pick | move npc:rob along
 *
 * move npc:rob to:$( pick 1 ) facing:$( pick 1 )
 * move npc:rob fast to:$( pick 1 )
 * ```
 */
export async function move(
  ct: JshCli.RunArg,
  opts: Omit<JshCli.MoveOpts, "to"> & {
    to?: JshCli.PointAnyFormat | JshCli.PointAnyFormat[];
    along: boolean;
  } = ct.api.jsArg(ct.args, { npc: "npcKey" }),
) {
  const { api } = ct;

  if (!opts.to && api.isTtyAt(0)) {
    throw Error("opts.to required sans pipe");
  }

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
export async function move_const(
  ct: JshCli.RunArg,
  opts: Omit<JshCli.MoveOpts, "to"> & {
    to: JshCli.PointAnyFormat | JshCli.PointAnyFormat[];
  } = ct.api.jsArg(ct.args, { npc: "npcKey" }),
) {
  const { getNpcOrThrow, pendingMoves, handleStatus, handlePausedError } = moveHandlingFactory(ct, opts.npcKey);
  const { dispose } = handleStatus();
  const { w } = ct;

  try {
    const npc = getNpcOrThrow();

    pendingMoves.push(...(isArrayOfPoints(opts.to) ? opts.to : [opts.to]));
    let next: undefined | JshCli.PointAnyFormat;

    while ((next = pendingMoves.shift())) {
      await w.npc
        .move({ npcKey: npc.key, to: next, arrive: pendingMoves.length === 0, fast: opts.fast })
        .catch(handlePausedError);
    }
  } finally {
    dispose();
  }
}

/**
 * move smoothly along lazily supplied path
 * e.g. `pick | move npc:rob along`
 */
export async function move_lazy(
  ct: JshCli.RunArg,
  opts: Omit<JshCli.MoveOpts, "to"> = ct.api.jsArg(ct.args, { npc: "npcKey" }),
) {
  const { getNpcOrThrow, pendingMoves, handleStatus, handlePausedError } = moveHandlingFactory(ct, opts.npcKey);
  const { dispose } = handleStatus();
  const { w, api } = ct;

  try {
    let pendingRead = api.read();
    while (true) {
      const shouldRead = pendingMoves.length === 0;
      const dst: undefined | symbol | JshCli.PointAnyFormat = pendingMoves.shift() ?? (await pendingRead);
      if (dst === api.eof) break;
      if (shouldRead) pendingRead = api.read();

      const npc = getNpcOrThrow();

      const movePromise = w.npc
        .move({ npcKey: npc.key, to: dst as JshCli.PointAnyFormat, fast: opts.fast })
        .catch((e) => {
          if (e instanceof Error && e.message === "not navigable") {
            return; // ignore non-navigable stdin
          }
          if (e instanceof Error && e.message === "stuck") {
            // ignore all pending destinations when stuck
            api.flush();
            pendingMoves.length = 0;
            return;
          }
          return handlePausedError(e);
        });

      await Promise.race([movePromise, pendingRead.then(() => npc.preventArrival())]);
      await movePromise;
    }
  } finally {
    dispose();
  }
}

/**
 * move immediately to latest destination
 * e.g. `pick | move npc:rob`
 */
export async function move_next(
  ct: JshCli.RunArg,
  opts: Omit<JshCli.MoveOpts, "to"> = ct.api.jsArg(ct.args, { npc: "npcKey" }),
) {
  const { getNpcOrThrow, pendingMoves, handleStatus, handleMoveError } = moveHandlingFactory(ct, opts.npcKey);
  const { dispose } = handleStatus();
  const { w, api } = ct;

  try {
    let pendingRead = api.read();
    let next: undefined | JshCli.PointAnyFormat;

    while ((next = pendingMoves.shift() ?? (await pendingRead)) !== api.eof && next) {
      const npc = getNpcOrThrow();
      const movePromise = w.npc.move({ npcKey: npc.key, to: next, fast: opts.fast }).catch(handleMoveError);
      await Promise.race([movePromise, (pendingRead = api.read())]);
    }
  } finally {
    dispose();
  }
}

/**
 * ```sh
 * nudge npc:kate
 * nudge npc:kate src:rob
 * nudge npc:kate src:$( pick 1 ) by:1
 * ```
 */
export async function nudge(
  ct: JshCli.RunArg,
  opts: { npcKey: string; src?: string | JshCli.PointAnyFormat; by?: number } = ct.api.jsArg(ct.args, {
    npc: "npcKey",
    from: "src",
  }),
) {
  const { w } = ct;
  const npc = w.npc.get(opts.npcKey);

  opts.by ??= 0.5;

  if (!opts.src) {
    const angle = Math.random() * Math.PI * 2;
    opts.src = { x: npc.point.x + opts.by * Math.cos(angle), y: npc.point.y + opts.by * Math.sin(angle) };
  }

  if (typeof opts.src === "string") {
    opts.src = w.npc.get(opts.src).point;
  }

  const src = npc.point;
  const delta = Vect.from(src).sub(w.helper.parseGroundPoint(opts.src)).normalize(opts.by);
  await w.npc.move({
    npcKey: npc.key,
    to: { x: src.x + delta.x, y: src.y + delta.y },
  });
}

/**
 * Move npc away from nearby boundary e.g. to avoid blocking others.
 * ```sh
 * pad npc:kate
 * pad npc:kate by:1
 * pad kate
 * ```
 */
export async function pad(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey: string; by?: number } = api.jsArg(args, { npc: "npcKey" }),
) {
  const npc = w.npc.get(opts.npcKey ?? args[0]);
  const agent = npc.agent;
  if (!agent) throw Error("no agent");

  const [seg] = agent.boundary.segments;
  if (seg === undefined) {
    throw Error("boundary too far");
  }

  // move away from 1st seg
  const src = npc.point;
  const delta = Vect.from(seg.s[3 + 2] - seg.s[0 + 2], -(seg.s[3 + 0] - seg.s[0 + 0])).normalize(opts.by ?? 0.5);

  await w.npc
    .move({
      npcKey: npc.key,
      to: { x: src.x + delta.x, y: src.y + delta.y },
    })
    .catch(() => {}); // ignore stuck
}

/**
 * ```sh
 * park npc:kate
 * park kate
 * ```
 */
export async function park(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey: string } = api.jsArg(args, { npc: "npcKey" }),
) {
  const npc = w.npc.get(opts.npcKey ?? args[0]);
  const agent = npc.agent;
  if (!agent) throw Error("no agent");

  // handle too far from boundary or just spawned
  if (agent.boundary.segments.length === 0) {
    const extendedCollisionQueryRange = 2;
    const result = w.npc.getClosestPoly(npc.position);
    localBoundary.updateLocalBoundary(
      agent.boundary,
      result.nodeRef,
      w.helper.groundPointToTuple(npc.point),
      extendedCollisionQueryRange,
      w.nav.navMesh,
      npc.queryFilter,
    );
  }

  const [seg] = agent.boundary.segments;
  if (seg === undefined) {
    throw Error("boundary too far");
  }

  const currentPoint = npc.point;

  // assume 1st segment closest i.e. `seg.d` minimal
  const closest = geomService.getClosestOnSeg(
    currentPoint,
    { x: seg.s[0 + 0], y: seg.s[0 + 2] },
    { x: seg.s[3 + 0], y: seg.s[3 + 2] },
  );

  // seems to always face outwards 🤞
  const facing = { x: currentPoint.x + (seg.s[3 + 2] - seg.s[2]), y: currentPoint.y + (seg.s[0] - seg.s[3]) };

  if (seg.d > 0.0005) {
    await npc.fadeSpawn({
      at: closest,
      facing,
    });
  } else {
    await npc.look(facing);
  }
}

export function pause({ w }: JshCli.RunArg) {
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

  const { opts, operands } = ct.api.getOpts(args, {
    boolean: [
      "left", // left clicks only
      "right", // right clicks only
      "long", // long press only
      "any", // left or right permitted
      "fifo", // default lifo: new picks take priority over old ones
    ],
  });

  if (opts.right === false && opts.any === false) {
    opts.left = true; // default to left clicks only
  }

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
  const jsOpts = api.jsArg(args) as { as?: string };
  const selector = jsOpts.as ? api.generateSelector(api.parseFnOrStr(jsOpts.as)) : undefined;

  let eventsSub: import("@npc-cli/util").BasicSubscription;

  // suspend/resume handled by `api.isRunning()` below
  const handlers = api.handleStatus({
    cleanups() {
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

export function play({ w }: JshCli.RunArg) {
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
 * ```
 */
export async function remove({ w, args }: JshCli.RunArg) {
  if (args.length === 1) {
    if (args[0] === "npcs") {
      return w.e.removeNpcs(...Object.keys(w.n));
    } else if (args[0] === "decor") {
      return w.decor.remove(...Object.keys(w.decor.runtime.byKey));
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
 * say hi npc:rob secs:5
 * say hi npc:rob for:10
 * say hi npc:rob for:Infinity
 * ```
 */
export function say(
  { api, args, w }: JshCli.RunArg<JshCli.PointAnyFormat>,
  opts: { npcKey: string; words?: string; secs?: number } = api.jsArg(args, { npc: "npcKey", for: "secs" }),
) {
  const npc = w.npc.get(opts.npcKey);
  const words = opts.words ?? api.getJsOperands(args, opts).join(" ");

  if (words) {
    w.speech.say(npc.key, words, opts.secs);
  }
}

/**
 * ```sh
 * skin npc:rob medic-0
 * skin npc:rob as:medic-0
 * ```
 */
export function skin(
  { api, args, w }: JshCli.RunArg,
  opts: { npcKey: string; as?: string } = api.jsArg(args, { npc: "npcKey" }),
) {
  const npc = w.npc.get(opts.npcKey);
  const skinKey = opts.as ?? (api.getJsOperands(args, opts)[0] || "medic-0");

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
 *
 * # spawn multiple
 * pick | spawn npc:rob-
 *
 * spawn npc:rob at:$( pick 1 ) angle:Math.PI
 * spawn npc:rob at:$( pick 1 ) facing:$( pick 1 )
 *
 * # alternating (at, facing)
 * pick | spawn npc:rob- facing
 *
 * pick | spawn npc:rob-
 *
 * 🚧 use --force instead somehow
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
 * unlock doors:['g0d29','g0d30']
 * ```
 */
export async function unlock(
  { api, args, w }: JshCli.RunArg,
  opts: { all?: boolean; doors?: Geomorph.GmDoorKey[] } = api.jsArg(args),
) {
  const inputs = opts.all === true ? keys(w.door.byKey) : (opts.doors ?? args);
  for (const gdKey of inputs) {
    if (w.helper.isGmDoorKey(gdKey)) w.e.toggleLock(gdKey, { unlock: true });
    else throw Error(`invalid gdKey: ${gdKey}`);
  }
  w.view.forceUpdate();
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
    cleanups() {
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

export async function warp(
  { w, api, args }: JshCli.RunArg,
  opts: { npcKey: string; to: MaybeMeta<JshCli.PointAnyFormat> } = api.jsArg(args, { npc: "npcKey" }),
) {
  const npc = w.npc.get(opts.npcKey);
  await npc.fadeSpawn({ at: opts.to });
}

function isArrayOfPoints(x: unknown): x is JshCli.PointAnyFormat[] {
  return Array.isArray(x) && typeof x[0] !== "number";
}
