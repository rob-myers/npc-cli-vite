# Browser scenarios

The ONLY doc for checking a change by driving the app in a browser you can watch, and the log of
scenarios run that way: each step's shell commands, as typed, and what came of them.

## The approach

- **A production preview**, not the dev server: a DEV World draws `sheet/skin.N.png` and saves it
  (see `docs/skins.md`), which a check should not do.
- **A visible Chrome** with its own profile, so your own browser is untouched, and a remote
  debugging port for the scripts below.
- **Everything happens through the app's own jsh terminal**: commands are typed into `tty-0`
  character by character, so they show there as though typed by hand, and stay in its history.
  The debugging port is used for nothing else but reading state back, and screenshots.
- **One step at a time.** Before each step, say what will be typed; after it, report what came of
  it, then wait for "next". Whoever is watching may move the camera in between.
- **Players are moved, not spawned**: `move rob to:[…]` walks them, through doors and all, as play
  would. `spawn` is for setting a scenario up.

### Setup

```sh
S=/tmp/npc-scenario   # any scratch directory
pnpm build && rm -rf $S/site && mkdir -p $S && cp -r packages/app/dist $S/site
(cd packages/app && pnpm exec vite preview --outDir $S/site --port 4726 --strictPort &)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9381 \
  --user-data-dir=$S/profile --no-first-run --window-size=1200,900 http://localhost:4726/ &
```

The copy of `dist` keeps the preview serving the same build whilst `pnpm build` runs again.

### Scripts

`$S/type.mjs` types a command into the terminal, then Enter:

```js
const t = (await (await fetch("http://127.0.0.1:9381/json")).json()).find((x) => x.type === "page" && x.url.includes("4726"));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { pend.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
await send("Runtime.evaluate", { expression: `document.querySelector(".xterm-helper-textarea").focus()` });
for (const ch of process.argv[2]) { await send("Input.insertText", { text: ch }); await new Promise((r) => setTimeout(r, 25)); }
const enter = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...enter });
await send("Input.dispatchKeyEvent", { type: "char", text: "\r", ...enter });
await send("Input.dispatchKeyEvent", { type: "keyUp", ...enter });
ws.close();
```

`$S/ev.mjs` reads state back: it finds the World's state through React's fibers as `window.__w`,
then prints the value of its argument. Return plain data — a whole World is too deep to send back.

```js
const t = (await (await fetch("http://127.0.0.1:9381/json")).json()).find((x) => x.type === "page" && x.url.includes("4726"));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? { exceptionDetails: { text: JSON.stringify(m.error) } }); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { pend.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
await ev(`void (window.__w ?? (() => { const el = document.querySelector("canvas"); const k = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  for (let f = el[k]; f; f = f.return) for (let h = f.memoizedState; h && typeof h === "object"; h = h.next) { const s = h.memoizedState; if (s && s.psi && s.player && s.n) { window.__w = s; return; } } })())`);
console.log(JSON.stringify(await ev(process.argv[2])));
ws.close();
```

`$S/shot.mjs` saves a screenshot of the window to its argument:

```js
import fs from "node:fs";
const t = (await (await fetch("http://127.0.0.1:9381/json")).json()).find((x) => x.type === "page" && x.url.includes("4726"));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id === 1) { fs.writeFileSync(process.argv[2], Buffer.from(m.result.data, "base64")); ws.close(); } };
ws.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } }));
```

For example:

```sh
node $S/type.mjs 'sword --on npc-3'
node $S/ev.mjs '__w.swords.swords.get("npc-3")?.rope.to'
node $S/shot.mjs $S/step-2.png
```

## Scenarios

### A sword rope seen from another room

**The bug.** Lock npc-3 on to npc-4, then take the player into another room and close the door:
npc-3's rope, and the ball on its end, still show — though the npcs themselves have gone dark with
their room.

**The fix under test.** Each sword instance carries both ends' npcs' room slots and lit flags
(`roomData` in `Swords.tsx`), and `service/sword-shader.ts` fades the rope and ball by
`fadeRoomsFx.getVisiblity`, bar a lit npc, as `NPCs` drains a figure: the ball with the target, the
rope with whichever end it is nearer.

The map's default, from a fresh Chrome profile so nothing saved carries over: player `rob` alone in
room `g0r1` at `[2.08, 0, 4.69]`, follow `off`, every door shut, rooms faded in `sight` mode.

Two earlier runs were abandoned. The first spawned rob into the next room rather than walking them
there, and looked with `w view.lookAtPlayer`, which frames the follow's goal without the look
button's hold. The second walked rob to `[2.08, 0, 10.69]` — through `g0d29` into `g0r2`, then
`g0d28` into `g0r3`: two rooms on, too far for kate's room to be in frame. `g0r1` runs from `g0d30`
at `z = 1.5` to `g0d29` at `z = 6`.

1. **Two npcs near the player.**

   ```sh
   spawn kate at:[2.08,0,2.69] as:robot-0
   spawn npc-3 at:[0.58,0,5.19] as:robot-0
   ```

   Two robots: kate 2 m ahead of rob, at `[2.08, 2.69]`; npc-3 behind them to one side, nudged by
   the crowd to `[0.9, 5.1]`. All three in `g0r1`. A fresh load starts the World paused.

2. **npc-3 locks on to kate**, the World resumed first.

   ```sh
   play
   sword --on npc-3
   sword npc-3 lock:kate part:head
   ```

   Running; npc-3's sword drawn, locked on (`rope.locked.presence` `1`), and in sight of her.

3. **The player walks just outside**, through `g0d29` into `g0r2` — followed loosely first, as the
   look button's long-press menu would.

   ```sh
   w view.setFollowMode loose
   move rob to:[2.08,0,6.8]
   ```

   Following `loose` (the look button shows it). rob stopped at `[2.08, 6.7]` in `g0r2`, `g0d29`
   left open behind them, the camera close in on them — npc-3 seen through the doorway, still
   locked on to kate.

4. **The door shuts behind them**, by itself once they are clear — waited for, not closed by hand.
   `g0d29` shut (open ratio `0`) within moments; npc-3 still locked on to kate.

5. **Zoomed out**, by a nudge past `zoomCommitOut` (`0.9`), which `syncZoom` then eases the rest
   of the way to the outer stop, as a wheel's would.

   ```sh
   w view.controls.addZoomProgress -0.2
   ```

   `zoomProgress` `1` to `0`, the radius settling at `8.3`. rob in `g0r2`, its walls and the door
   back to `g0r1` in view, all beyond them black — and no rope or ball anywhere, though npc-3 is
   still locked on to kate with the rope shown (`rope.shown.presence` `1`): the room fade hides it.

6. **A control: the door opened**, so rob sees into `g0r1` again, then left to shut itself.

   ```sh
   open g0d29
   ```

   Open, `g0r1` lit up beyond the doorway: npc-3 in view, their rope running faintly off towards
   kate. The door shut itself about 5 s later, and the room went black again, the rope and ball
   fading out with it.

**Verdict: fixed.** The rope and its ball show while the player can see into the room, and are
hidden once they can't, just as the npcs themselves are.
