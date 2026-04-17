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
