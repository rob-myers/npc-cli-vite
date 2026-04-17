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
 * w npc.spawn '{ npcKey: "rob", position: [0,0,0] }'
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
