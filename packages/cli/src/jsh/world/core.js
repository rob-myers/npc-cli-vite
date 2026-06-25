import { isStringInt, keys } from "@npc-cli/util/legacy/generic";

/**
 * @param {JshCli.RunArg} ct
 */
export async function* awaitWorld({ api, home: { WORLD_KEY } }) {
  if (typeof WORLD_KEY !== "string") {
    throw Error("WORLD_KEY not a string");
  }

  yield `${api.ansi.Cyan}awaiting ${api.ansi.White}${WORLD_KEY}`;

  while (api.getCached(WORLD_KEY)?.isReady(api.meta.sessionKey) !== true) {
    await api.sleep(0.05);
  }
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
 * @template {JshCli.Event} [T=JshCli.Event]
 * @param {JshCli.RunArg} ct
 * @param {{ where?(e: JshCli.Event): e is T }} [opts]
 */
export async function* events({ api, args, w }, opts = api.jsArg(args)) {
  const filter = opts.where ?? (args[0] ? api.generateSelector(api.parseFnOrStr(args[0]), []) : undefined);
  const asyncIterable = api.observableToAsyncIterable(w.events);
  const handlers = api.handleStatus({
    cleanups() {
      asyncIterable.return?.();
    },
  });

  for await (const event of asyncIterable) {
    if (filter === undefined || filter(event)) {
      yield/** @type {T} */ (event);
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
 * @param {JshCli.RunArg} ct
 * @param {{ npcKey: string; all?: boolean; doors?: Geomorph.GmDoorKey[] }} [opts]
 */
export function grant({ api, args, w }, opts = api.jsArg(args, { npc: "npcKey" })) {
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
 * @param {JshCli.RunArg} ct
 * @param {{ npcKey: string; } & Partial<JshCli.NpcLabelStyle>} [opts]
 */
export function label({ api, args, w }, opts = api.jsArg(args, { npc: "npcKey" })) {
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
 * @param {JshCli.RunArg} ct
 * @param {{ all?: boolean; doors?: Geomorph.GmDoorKey[] }} [opts]
 */
export async function lock({ api, args, w }, opts = api.jsArg(args)) {
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
 * @param {JshCli.RunArg<string | JshCli.PointAnyFormat>} ct
 * @param {{ npcKey: string; at: string | JshCli.PointAnyFormat }} [opts]
 */
export async function look({ api, args, w, datum }, opts = api.jsArg(args, { npc: "npcKey", to: "at", face: "at" })) {
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
 * @param {JshCli.RunArg<JshCli.PointAnyFormat>} ct
 * @param {Omit<JshCli.MoveOpts, 'to'> & { to: JshCli.PointAnyFormat | JshCli.PointAnyFormat[]; along: boolean }} [opts]
 */
export async function move({ api, args, w, datum }, opts = api.jsArg(args, { npc: "npcKey" })) {
  const npc = w.npc.get(opts.npcKey);

  const { dispose } = api.handleStatus({
    cleanups: (killed) => killed && npc.rejectAll(new Error("killed")),
  });

  npc.moveClip = opts.fast ? npc.clips.run : npc.clips.walk;

  try {
    if (api.isTtyAt(0)) {
      // move to point or smoothly along points
      const points = expectArrayOfPoints(opts.to) ? opts.to : [opts.to];
      for (const [index, point] of points.entries()) {
        await w.npc.move({ npcKey: opts.npcKey, to: point, arrive: index === points.length - 1 });
      }
      return;
    }

    if (!opts.along) {
      // move immediately to lastest destination
      while ((datum = await api.read()) !== api.eof) {
        w.npc.move({ npcKey: opts.npcKey, to: datum });
      }
      return;
    }

    // move smoothly along lazily supplied path
    let pendingRead = api.read();
    while (true) {
      const next = await pendingRead;
      if (next === api.eof) break;

      datum = next;
      pendingRead = api.read();
      const movePromise = w.npc.move({ npcKey: opts.npcKey, to: datum }).catch((e) => {
        if (e instanceof Error && e.message === "not navigable") {
          // ignore non-navigable stdin
          return;
        }
        if (e instanceof Error && e.message === "stuck") {
          // ignore all pending reads when stuck
          // api.writeError(`move: ${e.message}`);
          api.flush();
          pendingRead = api.read();
          return;
        }
        throw e;
      });

      // biome-ignore format: avoid newlines
      await Promise.race([movePromise, pendingRead.then(() => { npc.arrive = false; })]);
      await movePromise;
    }
  } finally {
    dispose();
  }
}

/**
 * @param {JshCli.RunArg} ct
 */
export function pause({ w }) {
  w.setDisabled(true);
}

/**
 * @param {JshCli.RunArg} ct
 */
export function play({ w }) {
  w.setDisabled(false);
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
 * ```
 *
 * Priority:
 * - given `pick m` and `pick n` execution order wins
 * - given two `pick`s execution order wins
 * - `pick m` always executes before `pick`
 * - on execute `pick m --fifo` it defers priority
 *
 * @param {JshCli.RunArg} ct
 */
export async function* pick(ct) {
  const { args, api, w } = ct;

  let { opts, operands } = ct.api.getOpts(args, {
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
  if (!isStringInt(operands[0]) && isStringInt(operands[1])) {
    // support reverse order `pick meta.nav 2`
    operands = [operands[1], operands[0]];
  }

  const explicitNumPicks = isStringInt(operands[0]) ? parseInt(operands[0], 10) : undefined;
  const maxExplicitPicks = 1024;

  /** Number of picks remaining */
  let numPicks = explicitNumPicks ?? Number.MAX_SAFE_INTEGER;
  if (explicitNumPicks !== undefined && explicitNumPicks > maxExplicitPicks) {
    numPicks = maxExplicitPicks;
    api.writeError(`${api.ansi.Yellow}warn: max explicit picks is ${maxExplicitPicks}`);
  }

  const lifo = opts.fifo !== true;
  const clickId = isStringInt(operands[0]) ? api.getUid() : undefined;

  // support `pick meta.floor`
  // support `pick '({ meta }, ct) => meta.type === "floor"'`
  const filterDef = isStringInt(operands[0]) ? operands[1] : operands[0];
  const filter =
    filterDef !== undefined && !filterDef.startsWith("as:")
      ? api.generateSelector(api.parseFnOrStr(filterDef), [ct])
      : undefined;

  // support jsArg as:foo.bar.baz (apply selector)
  const jsOpts = /** @type {{ as?: string }} */ (api.jsArg(args));
  const selector = jsOpts.as ? api.generateSelector(api.parseFnOrStr(jsOpts.as)) : undefined;

  /** @type {import('@npc-cli/util').BasicSubscription} */
  let eventsSub;

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
      const output = await /** @type {Promise<JshCli.PickEvent>} */ (
        new Promise((resolve, reject) => {
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
        })
      );

      if (
        (opts.left === true && output.rightDown === true) ||
        (opts.right === true && output.rightDown === false) ||
        opts.long !== output.longDown
      ) {
        continue;
      }

      if (filter === undefined || filter?.(output)) {
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
 * @param {JshCli.RunArg} ct
 * @param {object} [opts]
 * @param {JshCli.PointAnyFormat | string} opts.src
 * @param {JshCli.PointAnyFormat | string} opts.dst
 * @param {boolean} [opts.point] Output point.
 * @param {boolean} [opts.detail] Output detailed result.
 */
export async function ray({ api, args, w }, opts = api.jsArg(args, { from: "src", to: "dst" })) {
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
 * @param {JshCli.RunArg} ct
 */
export async function remove({ w, args }) {
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
  setTimeout(() => w.view.forceUpdate());
}

/**
 * ```sh
 * revoke npc:rob g0d29
 * revoke npc:rob g0d{0..5}
 * revoke npc:rob all
 * ```
 * @param {JshCli.RunArg} ct
 * @param {{ npcKey: string; all?: boolean; doors?: Geomorph.GmDoorKey[] }} [opts]
 */
export function revoke({ api, args, w }, opts = api.jsArg(args, { npc: "npcKey" })) {
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
 * say hi npc:rob
 * say npc:rob
 * ```
 *
 * @param {JshCli.RunArg<JshCli.PointAnyFormat>} ct
 * @param {{ npcKey: string; words?: string }} [opts]
 */
export function say({ api, args, w }, opts = api.jsArg(args, { npc: "npcKey" })) {
  const npc = w.npc.get(opts.npcKey);
  const words = opts.words ?? api.getJsOperands(args, opts).join(" ");

  if (words) {
    const bubble = w.bubble.ensure(npc.key);
    bubble.setWords(words);
  } else {
    w.bubble.delete(npc.key);
  }
}

/**
 * ```sh
 * skin npc:rob medic-0
 * skin npc:rob as:medic-0
 * ```
 * @param {JshCli.RunArg} ct
 * @param {{ npcKey: string; as?: string }} [opts]
 */
export function skin({ api, args, w }, opts = api.jsArg(args, { npc: "npcKey" })) {
  const npc = w.npc.get(opts.npcKey);
  const skinKey = opts.as ?? (api.getJsOperands(args, opts)[0] || "medic-0");

  if (w.npc.getSkinIndex(skinKey) === -1) {
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
 * @param {JshCli.RunArg<JshCli.PointAnyFormat>} ct
 * @param {JshCli.SpawnOpts & { force?: boolean }} [opts]
 */
export async function spawn(
  { api, args, w, datum },
  opts = api.jsArg(args, { npc: "npcKey", to: "at", skin: "as", towards: "facing", look: "facing" }),
) {
  if (api.isTtyAt(0)) {
    return await w.npc.spawn(opts);
  }

  /** @param {unknown} e */
  function ignoreSpawnErrors(e) {
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
 *
 * @param {JshCli.RunArg} ct
 */
export async function* w(ct) {
  const { api, args, w } = ct;

  // support piped inputs via hyphen args -
  // e.g. `pick 1 | w e.findRoomContaining -`
  const stdinInputChar = "-";
  const readStdin = args.slice(1).some((arg) => arg === stdinInputChar);

  let reject = /** @param {*} _e */ (_e) => {};
  const handlers = api.handleStatus({
    cleanups() {
      reject(new Error("potential ongoing computation"));
    },
  });
  /** @param {any} value */
  async function awaitOrIgnore(value) {
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

  /** @type {*} */ let datum;
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
 * unlock g0d29 g0d30
 * unlock doors:['g0d29','g0d30']
 * ```
 * @param {JshCli.RunArg} ct
 * @param {{ all?: boolean; doors?: Geomorph.GmDoorKey[] }} [opts]
 */
export async function unlock({ api, args, w }, opts = api.jsArg(args)) {
  const inputs = opts.all === true ? keys(w.door.byKey) : (opts.doors ?? args);
  for (const gdKey of inputs) {
    if (w.helper.isGmDoorKey(gdKey)) w.e.toggleLock(gdKey, { unlock: true });
    else throw Error(`invalid gdKey: ${gdKey}`);
  }
  w.view.forceUpdate();
}

/**
 * @param {unknown} x
 * @returns {x is JshCli.PointAnyFormat[]}
 */
function expectArrayOfPoints(x) {
  return Array.isArray(x) && typeof x[0] !== "number";
}
