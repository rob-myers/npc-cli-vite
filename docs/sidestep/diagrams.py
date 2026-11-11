"""Writes the sidestep sub-diagrams as SVG flows, styled as coming-stages.svg."""
from html import escape

BG, BOX, EDGE, TEXT, MUTED = "#1b1d22", "#262a31", "#3a404a", "#e6e6e6", "#9aa0a6"
STYLES = {
    "normal": (BOX, EDGE, TEXT),
    "blue": ("#1f2d42", "#5aa0f0", "#8cc0ff"),
    "green": ("#1f3a2c", "#4ec98a", "#4ec98a"),
}
PILLS = {"red": ("#3a2426", "#e06c6c", "#f0a0a0"), "yellow": ("#2a2618", "#d8b46a", "#e8c880")}
W, BX, BW, PX, PW = 760, 60, 400, 524, 212


def flow(name, title, steps, notes=(), brackets=()):
    out, y = [], 56
    tops = []
    for i, step in enumerate(steps):
        lines = step.get("lines", [])
        h = 28 + 15 * len(lines)
        fill, stroke, head = STYLES[step.get("style", "normal")]
        rx = 22 if step.get("style") == "green" and h <= 50 else 8
        tops.append((y, h))
        out.append(f'<rect x="{BX}" y="{y}" width="{BW}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}"/>')
        out.append(f'<text x="{BX + 16}" y="{y + 19}" fill="{head}" font-weight="600">{escape(step["title"])}</text>')
        for j, line in enumerate(lines):
            out.append(f'<text x="{BX + 16}" y="{y + 36 + 15 * j}" fill="{MUTED}" font-size="12">{escape(line)}</text>')
        if "fail" in step:
            text, color = step["fail"] if isinstance(step["fail"], tuple) else (step["fail"], "red")
            pfill, pline, ptext = PILLS[color]
            mid = y + min(h, 46) / 2
            out.append(f'<line x1="{BX + BW}" y1="{mid}" x2="{PX - 6}" y2="{mid}" stroke="{pline}" stroke-width="1.5" marker-end="url(#{color})"/>')
            out.append(f'<rect x="{PX}" y="{mid - 12}" width="{PW}" height="24" rx="12" fill="{pfill}"/>')
            out.append(f'<text x="{PX + 12}" y="{mid + 4}" fill="{ptext}" font-size="12">{escape(text)}</text>')
        if i + 1 < len(steps):
            out.append(f'<line x1="{BX + BW / 2}" y1="{y + h}" x2="{BX + BW / 2}" y2="{y + h + 16}" stroke="#7a8290" stroke-width="1.5" marker-end="url(#down)"/>')
        y += h + 18
    for first, last, label in brackets:
        (y0, h0), (y1, h1) = tops[first], tops[last]
        top, bottom = y0 + 2, y1 + h1 - 2
        out.append(f'<path d="M48,{top} L36,{top} L36,{bottom} L48,{bottom}" fill="none" stroke="{MUTED}" stroke-width="1.5"/>')
        mid = (top + bottom) / 2
        out.append(f'<text x="28" y="{mid}" fill="{MUTED}" font-size="12" text-anchor="middle" transform="rotate(-90 28 {mid})">{escape(label)}</text>')
    y += 4
    for line in notes:
        out.append(f'<text x="24" y="{y}" fill="{MUTED}" font-size="12">{escape(line)}</text>')
        y += 16
    height = y + 8
    markers = "".join(
        f'<marker id="{k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{c}"/></marker>'
        for k, c in [("down", "#7a8290"), ("red", "#e06c6c"), ("yellow", "#d8b46a")]
    )
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {height}" width="{W}" height="{height}" '
        f"font-family=\"system-ui, -apple-system, 'Segoe UI', sans-serif\" font-size=\"13\">\n"
        f"<defs>{markers}</defs>\n"
        f'<rect width="{W}" height="{height}" rx="10" fill="{BG}"/>\n'
        f'<text x="24" y="32" fill="{TEXT}" font-size="15" font-weight="600">{escape(title)}</text>\n'
        + "\n".join(out)
        + "\n</svg>\n"
    )
    open(f"{name}.svg", "w").write(svg)


flow(
    "sidestep-makeway",
    "makeWay: one npc making way, asynchronously",
    [
        {"title": "mark stepping", "lines": ["the lookout passes them by until it's over"]},
        {"title": "ask the worker: op sidestep", "style": "blue",
         "lines": ["the kind from the hud, the npc, the walker's path", "and heading, and others near: see plan"]},
        {"title": "emit", "lines": ["the choice as a sidestep event, for --debug.", "No step: stand, or no room for the kind"],
         "fail": ("no step: done", "yellow")},
        {"title": "react", "lines": ["wait 0.05 … 0.15s of game time (reactSecs)"]},
        {"title": "still free?", "lines": ["whyNot again: they may have moved or turned"], "fail": "not free: done"},
        {"title": "note home", "lines": ["unless back is stay: where they stand, or the", "home already kept from an earlier step"]},
        {"title": "perform", "style": "green",
         "lines": ["strafe to via, then to, facing the walker (shove)", "then look the way the choice faces"],
         "fail": "cut short: a red event"},
        {"title": "after the step",
         "lines": ["home's last = where they stopped, steps + 1", "settle only 0.3s before making way again"]},
        {"title": "finally", "lines": ["no longer stepping"]},
    ],
    notes=[
        "Cut short by stuck, it still counts as their step: where they stopped is last.",
        "Cut short by another move (move again), last is left, so that move pushing them off forgets home.",
    ],
)

flow(
    "sidestep-plan",
    "plan: the worker plans the kind asked (worker/sidestep.ts, planSidestep)",
    [
        {"title": "the ground", "lines": ["way: the walker's heading. across: square to it,",
                                        "toward the npc. walls within 5m. width across way"]},
        {"title": "find the kind's step", "lines": ["the kind and its tuning from the hud's debug item,", "slid along the navmesh"],
         "fail": "no room: they stay put"},
        {"title": "moves somewhere?", "lines": ["at least 0.2m (0.1m for turn). stand never moves"], "fail": "no: they stay put"},
        {"title": "a route there?", "lines": ["the navmesh route the crowd would walk (pathTo)"], "fail": "no route: stay put"},
        {"title": "clear of the walker?", "lines": ["each 0.1m keeps 0.6m from them, as they come", "0.5m on. Already nearer: comes no nearer"],
         "fail": "passes rob: stay put"},
        {"title": "ends clear?", "lines": ["at least 0.6m from the walker, or 0.15m further", "from them than they stood"], "fail": "ends near: stay put"},
        {"title": "take it", "style": "green", "lines": ["the step, its reason, the route drawn"]},
    ],
    notes=[
        "Staying put, --debug says why in red: kate didn't avoid rob: wall, held up, against the wall.",
        "The walker's path is carried on 2m along their way, so a spot further along their line isn't clear.",
        "aside: a clear spot within 2m, not within 45° of the way ahead, else 0.8m across.",
        "turn: a 0.2m half-step, turned side-on.   shuffle: a 0.3m shuffle across.   wall: an edge within 1m.",
        "doorway: an open door within 2m, 0.5m through.   back: in a way under 1.4m wide, on to where it is 2m.",
        "stand: they hold their ground.   Collapsed and dragged: they scoot along a wall, whatever the kind.",
        "Each limit is tuned per kind in the hud's debug item, or by jsh, e.g. sidestep kind:wall reach:2.",
    ],
)

flow(
    "sidestep-return",
    "returnBack: each tick, each home",
    [
        {"title": "back: stay?", "lines": ["the hud's back choice"], "fail": ("stay: homes dropped", "yellow")},
        {"title": "busy?", "lines": ["already returning, stepping, or moving"], "fail": "skip this tick"},
        {"title": "pushed off?", "lines": ["over 0.3m from their last step (returnSlack)"], "fail": ("forgets home", "yellow")},
        {"title": "already there?", "lines": ["within 3cm of the spot"], "fail": ("home dropped", "yellow")},
        {"title": "walker gone, and free?", "lines": ["their walker clear (1.5m) of the spot, or idle (1m)", "of it once stopped, or gone. And whyNot is null"], "fail": "wait"},
        {"title": "return", "style": "green",
         "lines": ["a returns event. Walk to prev (last) or to home's", "at (home), then shuffle in if over 3cm off"]},
        {"title": "after", "lines": ["there: home dropped, settle 0.3s"], "fail": "broken off: retried, twice"},
    ],
    notes=[
        "A home is where they stood before their first step aside. Later steps keep it,",
        "noting where each began (prev) and ended (last), however far, through doorways too.",
    ],
)

flow(
    "heldup-stages",
    "heldUp: the fallback, per walker, each tick",
    [
        {"title": "1  near", "lines": ["a crowd neighbour (agent.neis) within 0.7m (dist)"], "fail": "not near: not tested"},
        {"title": "2  ahead", "lines": ["in front of the walker's heading"], "fail": ("rob passed by kate", "yellow")},
        {"title": "3  on their way", "lines": ["within both radii + 0.1m (pathMargin) of the path,", "so their bodies meet"],
         "fail": ("kate clear of rob", "yellow")},
        {"title": "4  free", "lines": ["whyNot is null, not already stepping, and not", "yet asked by that walker this approach (asked)"], "fail": ("kate too busy for rob", "yellow")},
        {"title": "5  slowed", "lines": ["the walker below half their top speed (slowShare)", "for 0.05s (lingerSecs)"],
         "fail": "timed afresh"},
        {"title": "yield { walker, npc, why: null }", "style": "green", "lines": ["makeWay, its cause held up: see makeWay"]},
    ],
    notes=[
        "Each tick, for each moving walker bar sidestep's own movers: no due look. Only the crowd's neighbours are tested.",
        "A yellow reason is said by --debug in faint yellow, once each time it changes (skip, skipped).",
        "Like coming, it asks once per approach: a stepless plan is not asked again whilst that walker presses on.",
    ],
    brackets=[(0, 4, "for each neighbour")],
)
