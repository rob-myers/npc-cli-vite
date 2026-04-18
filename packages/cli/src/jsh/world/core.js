import { isStringInt, removeFirst } from "@npc-cli/util/legacy/generic";

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
 * ```sh
 * # unbounded unblocking left clicks
 * click
 * # exactly 1 blocking click
 * click 1
 * click | map meta.type
 * ```
 *
 * - Shows number of clicks in decor
 * @param {JshCli.RunArg} ct
 */
export async function* click(ct) {
  const { args, api, w } = ct;
  let { opts, operands } = ct.api.getOpts(args, {
    boolean: [
      "left", // left clicks only
      "right", // right clicks only
      "long", // long press only
      "any", // left or right permitted
      "block", // e.g. `click --block`
      "clear", // clear all colours
      "keep", // keep clicks of current color
      // --red, --blue, --green (default black)
    ],
  });

  if (opts["right"] === false && opts["any"] === false) {
    opts.left = true; // default to left clicks only
  }
  if (!isStringInt(operands[0]) && isStringInt(operands[1])) {
    operands = [operands[1], operands[0]]; // support reverse order `click meta.nav 2`
  }

  /** Number of clicks remaining */
  let numClicks = isStringInt(operands[0]) ? parseInt(operands[0]) : Number.MAX_SAFE_INTEGER;
  // const totalClicks = numClicks;
  const clickId = isStringInt(operands[0]) || opts.block === true ? api.getUid() : undefined;
  const blocking = clickId !== undefined;

  // support `click meta.nav`
  // support `click '({ meta }, ct) => meta.nav && ct.home.myTest'`
  const filterDef = isStringInt(operands[0]) ? operands[1] : operands[0];
  const filter = filterDef !== undefined ? api.generateSelector(api.parseFnOrStr(filterDef), [ct]) : undefined;

  /** @type {import('@npc-cli/util').BasicSubscription} */
  let eventsSub;

  // suspend/resume handled by `api.isRunning()` below
  const handlers = api.handleStatus({
    cleanups() {
      blocking === true && removeFirst(w.view.clickIds, clickId);
      eventsSub?.unsubscribe();
    },
  });

  try {
    while (numClicks > 0) {
      blocking === true && w.view.clickIds.push(clickId);

      const e = await /** @type {Promise<JshCli.PickEvent>} */ (
        new Promise((resolve, reject) => {
          eventsSub = w.events.subscribe({
            next(e) {
              if (e.key !== "picked") {
                return;
              } else if (api.isRunning() === false) {
                return;
              } else if (e.clickId !== undefined && clickId === undefined) {
                return; // `click {n}` overrides `click`
              } else if (e.clickId !== undefined && clickId !== e.clickId) {
                return; // later `click {n}` overrides earlier `click {n}`
              }
              resolve(e); // Must resolve before tear-down induced by unsubscribe
              eventsSub.unsubscribe();
            },
          });
          eventsSub.add(() => reject(api.getKillError()));
        })
      );

      // 🚧 provide position maybe earlier
      const output = e;

      if (filter === undefined || filter?.(output)) {
        numClicks--;
        yield output;
      }
    }
  } finally {
    handlers.dispose();
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
 * Usage:
 * ```sh
 * w
 * w key
 * w mapKey
 * w | keys
 * w npc.spawn '{ npcKey: "foo", position: [6, 0, 7.5] }'
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
  // e.g. `click 1 | w npc.findRoomContaining -`
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
