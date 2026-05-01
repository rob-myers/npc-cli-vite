import { isStringInt } from "@npc-cli/util/legacy/generic";

/**
 * @param {JshCli.RunArg} ctxt
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
 * - `config pickWalls` picks walls
 * - `config pickWalls 0` won't
 * @param {JshCli.RunArg} ctxt
 */
export async function config({ w, args, api }) {
  const [command, ...rest] = args;

  switch (command) {
    case "clearNpcs":
      w.npc.remove(...Object.keys(w.npc.npc));
      w.view.forceUpdate();
      break;
    case "pickWalls": {
      const [truthy] = rest.map(api.parseJsArg);
      w.view.objectPickScale = truthy === undefined || !!truthy ? 1 : 0.5;
      break;
    }
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
 * ```
 * @template {JshCli.Event} [T=JshCli.Event]
 * @param {JshCli.RunArg} ctxt
 * @param {{ where?(e: JshCli.Event): e is T }} [opts]
 */
export async function* events({ api, args, w }, opts = api.jsArg(args)) {
  const filter = !args[0] ? undefined : (opts.where ?? api.generateSelector(api.parseFnOrStr(args[0]), []));
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
 * move npc:rob to:$( pick 1 )
 * ```
 * @param {JshCli.RunArg} ctxt
 * @param {{ npcKey: string; to: JshCli.PointAnyFormat }} [opts]
 */
export async function move({ api, args, w }, opts = api.jsArg(args, { npc: "npcKey" })) {
  await w.npc.move(opts);
}

/**
 * @param {JshCli.RunArg} ctxt
 */
export function pause({ w }) {
  w.setDisabled(true);
}

/**
 * @param {JshCli.RunArg} ctxt
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
 * - on execute `pick m --block` it takes priority
 * - on execute `pick --block` it takes priority
 *
 * TODO
 * - 🚧 support right click
 * - 🚧 support long press
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
      "block", // e.g. `pick --block`
    ],
  });

  if (opts["right"] === false && opts["any"] === false) {
    opts.left = true; // default to left clicks only
  }
  if (!isStringInt(operands[0]) && isStringInt(operands[1])) {
    operands = [operands[1], operands[0]]; // support reverse order `click meta.nav 2`
  }

  const explicitNumClicks = isStringInt(operands[0]) ? parseInt(operands[0], 10) : undefined;
  const maxExplicitPicks = 1024;

  /** Number of clicks remaining */
  let numClicks = explicitNumClicks ?? Number.MAX_SAFE_INTEGER;
  if (explicitNumClicks !== undefined && explicitNumClicks > maxExplicitPicks) {
    numClicks = maxExplicitPicks;
    api.writeError(`${api.ansi.Yellow}warn: max explicit picks is ${maxExplicitPicks}`);
  }

  const blocking = opts.block === true;
  const clickId = isStringInt(operands[0]) || blocking ? api.getUid() : undefined;

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
    if (clickId !== undefined && blocking === false && numClicks <= maxExplicitPicks) {
      // e.g. `pick 5` but not `pick 5 --block`
      w.view.clickIds.push(...Array.from({ length: numClicks }, () => ({ id: clickId, blocking: false })));
    }

    while (numClicks > 0) {
      if (clickId !== undefined && blocking === true) {
        // e.g. `pick --block` `pick 5 --block` but not `pick 5`
        w.view.clickIds.unshift({ id: clickId, blocking });
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

      if (filter === undefined || filter?.(output)) {
        numClicks--;
        yield selector ? selector(output) : output;
      } else if (clickId !== undefined && blocking === false) {
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
 * ```sh
 * spawn npc:foo-bar-baz at:[7,0,7]
 * spawn npc:rob at:$( pick 1 | map point )
 * ```
 * @param {JshCli.RunArg} ctxt
 * @param {{ granted?: string } & JshCli.SpawnOpts} [opts]
 */
export async function spawn({ api, args, w }, opts = api.jsArg(args, { npc: "npcKey", skin: "as" })) {
  await w.npc.spawn(opts);
  // if (typeof opts.granted === 'string') {
  //   w.e.grantAccess(opts.granted, opts.npcKey);
  // }
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
  // e.g. `pick 1 | w npc.findRoomContaining -`
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
