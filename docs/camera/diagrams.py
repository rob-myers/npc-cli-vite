"""Writes the camera diagrams as SVGs, styled as docs/sidestep's. Run from this folder."""
from html import escape
from math import atan2, cos, degrees, radians, sin

BG, BOX, EDGE, TEXT, MUTED = "#1b1d22", "#262a31", "#3a404a", "#e6e6e6", "#9aa0a6"
BLUE, GREEN, AMBER, RED, GREY = "#5aa0f0", "#4ec98a", "#e0b050", "#e06c6c", "#7a8290"
STYLES = {
    "normal": (BOX, EDGE, TEXT),
    "blue": ("#1f2d42", BLUE, "#8cc0ff"),
    "green": ("#1f3a2c", GREEN, GREEN),
}
W = 760
FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif"
MARKERS = "".join(
    f'<marker id="{k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
    f'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{c}"/></marker>'
    for k, c in [("down", GREY), ("blue", BLUE), ("green", GREEN), ("amber", AMBER), ("muted", MUTED)]
)


def write(name, title, height, body):
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {height}" width="{W}" height="{height}" '
        f'font-family="{FONT}" font-size="13">\n<defs>{MARKERS}</defs>\n'
        f'<rect width="{W}" height="{height}" rx="10" fill="{BG}"/>\n'
        f'<text x="24" y="32" fill="{TEXT}" font-size="15" font-weight="600">{escape(title)}</text>\n'
        + "\n".join(body)
        + "\n</svg>\n"
    )
    open(f"{name}.svg", "w").write(svg)


def text(x, y, s, fill=TEXT, size=13, anchor="start", weight=None):
    w = f' font-weight="{weight}"' if weight else ""
    return f'<text x="{x}" y="{y}" fill="{fill}" font-size="{size}" text-anchor="{anchor}"{w}>{escape(s)}</text>'


def line(x1, y1, x2, y2, stroke=GREY, width=1.5, marker=None, dash=None):
    m = f' marker-end="url(#{marker})"' if marker else ""
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" stroke-width="{width}"{m}{d}/>'


def dot(x, y, label, fill, r=18, dark="#10131a"):
    return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}"/>' + text(x, y + 5, label, dark, 13, "middle", "700")


def wedge(cx, cy, r, from_deg, to_deg, fill, opacity):
    """A pie slice, angles clockwise from screen-up"""
    a, b = radians(from_deg), radians(to_deg)
    x1, y1 = cx + r * sin(a), cy - r * cos(a)
    x2, y2 = cx + r * sin(b), cy - r * cos(b)
    big = 1 if to_deg - from_deg > 180 else 0
    return f'<path d="M{cx},{cy} L{x1:.1f},{y1:.1f} A{r},{r} 0 {big} 1 {x2:.1f},{y2:.1f} z" fill="{fill}" opacity="{opacity}"/>'


def turned(c, about, deg):
    """`c` turned `deg` about `about`, clockwise on screen"""
    a = radians(deg)
    dx, dy = c[0] - about[0], c[1] - about[1]
    return (about[0] + dx * cos(a) - dy * sin(a), about[1] + dx * sin(a) + dy * cos(a))


def flow(name, title, steps, notes=()):
    out, y, BX, BW = [], 56, 60, 640
    for i, step in enumerate(steps):
        lines = step.get("lines", [])
        h = 28 + 15 * len(lines)
        fill, stroke, head = STYLES[step.get("style", "normal")]
        out.append(f'<rect x="{BX}" y="{y}" width="{BW}" height="{h}" rx="8" fill="{fill}" stroke="{stroke}"/>')
        out.append(text(BX + 16, y + 19, step["title"], head, 13, weight="600"))
        for j, s in enumerate(lines):
            out.append(text(BX + 16, y + 36 + 15 * j, s, MUTED, 12))
        if i + 1 < len(steps):
            out.append(line(BX + BW / 2, y + h, BX + BW / 2, y + h + 16, marker="down"))
        y += h + 18
    for s in notes:
        out.append(text(24, y + 4, s, MUTED, 12))
        y += 16
    write(name, title, y + 12, out)


flow(
    "camera-overview",
    "the camera: input, controls, then the World's framing",
    [
        {"title": "input", "lines": ["mouse and touch drags, the wheel and pinches (onMouseDown, onTouchStart)", "keys: framing presets, fade mode, wasd"]},
        {"title": "CameraControls (service/camera-controls.ts)", "style": "blue",
         "lines": ["pans, turns about a pivot, and zooms between two stops", "a custom MapControls, its props from WorldView's ctrlOpts"]},
        {"title": "WorldView", "lines": ["framing: fov and the floor seen at each stop (camera-view.ts)", "embodied: what may be steered. wasd heading: where the w-key heads"]},
        {"title": "following the player", "style": "green",
         "lines": ["frames the player and their frontier, read off the light sweep", "a look caps it, a far look extends it"]},
    ],
)

# gestures: a table, free vs following
rows = [
    ("left drag", "pans", "turns (panning is off)"),
    ("right drag", "turns", "turns"),
    ("Shift, ctrl or alt held", "swaps left and right", "swaps left and right"),
    ("middle button, wheel", "zooms, towards the cursor", "zooms"),
    ("one finger", "pans", "moves where the player looks. A tap picks"),
    ("two fingers, dragged", "turn", "turn"),
    ("two fingers, pinched", "zoom", "zoom"),
    ("two fingers, tapped", "a look, there", "a look, there"),
]
body, x0, x1, x2, y = [], 24, 250, 500, 64
body.append(f'<rect x="{x1 - 8}" y="{y - 18}" width="242" height="{26 * len(rows) + 30}" rx="6" fill="{BOX}"/>')
body.append(f'<rect x="{x2 - 8}" y="{y - 18}" width="244" height="{26 * len(rows) + 30}" rx="6" fill="#1f3a2c"/>')
body += [text(x0, y, "input", MUTED, 12, weight="600"), text(x1, y, "free", MUTED, 12, weight="600"),
         text(x2, y, "following", GREEN, 12, weight="600")]
for i, (a, b, c) in enumerate(rows):
    yy = y + 26 * (i + 1)
    if i in (4,):
        body.append(line(x0, yy - 18, W - 24, yy - 18, EDGE, 1))
    body += [text(x0, yy, a), text(x1, yy, b, MUTED), text(x2, yy, c, TEXT)]
yy = y + 26 * (len(rows) + 1) + 6
body.append(text(x0, yy, "Touch is below the rule. Following, one finger looks (touchLook): the camera needs no pan", MUTED, 12))
write("camera-gestures", "what each gesture moves", yy + 18, body)

# zoom: two stops, and pinch purity
body = []
ax0, ax1, ay = 110, 650, 110
body += [line(ax0, ay, ax1, ay, MUTED, 2), f'<circle cx="{ax0}" cy="{ay}" r="10" fill="{GREY}"/>',
         f'<circle cx="{ax1}" cy="{ay}" r="10" fill="{BLUE}"/>']
body += [text(ax0, ay + 32, "far stop", TEXT, 12, "middle"), text(ax0, ay + 48, "maxDistance", MUTED, 12, "middle"),
         text(ax0, ay + 64, "zoomProgress 0", MUTED, 12, "middle"), text(ax1, ay + 32, "near stop", BLUE, 12, "middle"),
         text(ax1, ay + 48, "minDistance", MUTED, 12, "middle"), text(ax1, ay + 64, "zoomProgress 1", MUTED, 12, "middle")]
mid = (ax0 + ax1) / 2
body += [line(mid, ay - 26, mid, ay + 26, GREY, 1.5, dash="5 4"), text(mid, ay + 44, "half way", MUTED, 12, "middle")]
p = ax0 + 0.3 * (ax1 - ax0)
body += [f'<circle cx="{p}" cy="{ay}" r="7" fill="{AMBER}"/>', line(p - 12, ay - 22, ax0 + 22, ay - 22, AMBER, 1.5, "amber"),
         text(p + 14, ay - 26, "let go here: eases to the nearer stop, once input pauses (zoomSettleMs)", AMBER, 12)]
by, b0, b1 = 250, 110, 650
cut = b0 + 0.35 * (b1 - b0)
body += [f'<rect x="{b0}" y="{by - 14}" width="{cut - b0}" height="28" fill="#1f2d42" stroke="{BLUE}"/>',
         f'<rect x="{cut}" y="{by - 14}" width="{b1 - cut}" height="28" fill="{BOX}" stroke="{EDGE}"/>',
         text((b0 + cut) / 2, by + 5, "pinch: zooms", "#8cc0ff", 13, "middle", "600"),
         text((cut + b1) / 2, by + 5, "drift: turns", TEXT, 13, "middle"),
         text(b0, by + 34, "0", MUTED, 12, "middle"), text(cut, by + 34, "pinchPurity 0.35", MUTED, 12, "middle"),
         text(b1, by + 34, "1", MUTED, 12, "middle"),
         text(24, by - 30, "two fingers: twoFingerRotateRatio, the smoothed share of centroid motion over spread", MUTED, 12)]
write("camera-zoom", "zoom: two stops, and only a pure pinch zooms", by + 56, body)

# turning about a pivot, from above: the same turn about T and about P
body = []
T, P, C = (170, 170), (270, 190), (170, 280)
C1, C2 = turned(C, T, -40), turned(C, P, -40)
for about, color in ((T, GREY), (P, BLUE)):
    r = ((C[0] - about[0]) ** 2 + (C[1] - about[1]) ** 2) ** 0.5
    body.append(f'<circle cx="{about[0]}" cy="{about[1]}" r="{r:.0f}" fill="none" stroke="{color}" stroke-dasharray="6 5" opacity="0.5"/>')
body += [line(C1[0], C1[1], C2[0] - 10, C2[1] + 4, AMBER, 2, "amber")]
body += [dot(*T, "T", GREY, 13), dot(*P, "P", BLUE, 13), dot(*C, "C", TEXT, 13), dot(*C1, "", GREY, 9), dot(*C2, "", BLUE, 9)]
body += [text(T[0], T[1] - 20, "target", MUTED, 12, "middle"), text(P[0] + 18, P[1] - 18, "pivot", BLUE, 12),
         text(C1[0] + 14, C1[1] + 18, "turned about T", MUTED, 12), text(C2[0] + 14, C2[1] + 4, "turned about P", BLUE, 12)]
body += [text(480, 110, "rotateAbout names the pivot: WorldView", MUTED, 12), text(480, 126, "gives the zoom crosshair whilst it shows.", MUTED, 12),
         text(480, 166, "The same turn about P and about T leaves", MUTED, 12), text(480, 182, "position - target the same, so the two", MUTED, 12),
         text(480, 198, "differ by a pure translation (amber),", AMBER, 12), text(480, 214, "which update applies (slideAboutPivot).", MUTED, 12),
         text(480, 254, "No pivot named: the turn is about T.", MUTED, 12)]
write("camera-pivot", "turns pivot on a point, from above", 360, body)

# wasd heading: snap wedges around each world axis
body = []
cx, cy, r = 250, 240, 150
for axis in (0, 90, 180, 270):
    body.append(wedge(cx, cy, r, axis - 20, axis + 20, GREEN, 0.18))
body.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{EDGE}"/>')
for axis, label in ((0, "N  -z"), (90, "E"), (180, "S"), (270, "W")):
    a = radians(axis)
    body.append(line(cx, cy, cx + r * sin(a), cy - r * cos(a), EDGE, 1))
    body.append(text(cx + (r + 22) * sin(a), cy - (r + 22) * cos(a) + 5, label, MUTED, 12, "middle"))
for deg, color, marker in ((12, GREEN, "green"), (45, AMBER, "amber")):
    a = radians(deg)
    body.append(line(cx, cy, cx + (r - 30) * sin(a), cy - (r - 30) * cos(a), color, 2.5, marker))
body.append(line(cx + 8, cy - 10, cx + 8, cy - r + 34, GREEN, 1.5, "green", "4 4"))
body += [text(430, 120, "Screen-up within 20° of an axis (compassSnapRad):", GREEN, 12),
         text(430, 136, "the w-key heads along that axis.", GREEN, 12),
         text(430, 176, "Further off: it heads up the screen.", AMBER, 12),
         text(430, 216, "Taken as the first move key goes down,", MUTED, 12),
         text(430, 232, "kept whilst any is held.", MUTED, 12),
         text(430, 272, "Whilst wasd_delta runs, a held key turns", MUTED, 12),
         text(430, 288, "the view until just within 20° of the", MUTED, 12),
         text(430, 304, "nearest axis, and no further.", MUTED, 12)]
write("camera-wasd", "wasd heading, from above: where the w-key heads", 420, body)

# following: the player, their frontier and the view's target, from above
body = []
Pl, F = (180, 270), (540, 210)
dx, dy = F[0] - Pl[0], F[1] - Pl[1]
bearing = 90 - degrees(atan2(-dy, dx))
body.append(wedge(*Pl, 300, bearing - 30, bearing + 30, "#f0e0a0", 0.07))
body.append(f'<circle cx="{Pl[0]}" cy="{Pl[1]}" r="150" fill="none" stroke="{AMBER}" stroke-dasharray="5 5" opacity="0.7"/>')
body.append(text(Pl[0] - 20, Pl[1] + 172, "a look caps it at its distance: focal 2m", AMBER, 12))
wallX = 700
k = (wallX - Pl[0]) / dx
body += [line(Pl[0], Pl[1], wallX - 6, Pl[1] + k * dy, AMBER, 1.5, "amber", "6 5"), line(wallX, 60, wallX, 380, MUTED, 4),
         text(wallX, 400, "wall", MUTED, 12, "middle")]
body += [line(Pl[0], Pl[1], F[0] - 12, F[1] + 2, BLUE, 2.5, "blue")]
Tg = (Pl[0] + 0.5 * dx, Pl[1] + 0.5 * dy)
body += [dot(*Pl, "P", GREEN, 16), dot(*F, "F", BLUE, 12), f'<circle cx="{Tg[0]}" cy="{Tg[1]}" r="7" fill="none" stroke="{TEXT}" stroke-width="2"/>']
body += [text(F[0] - 10, F[1] + 34, "frontier: the furthest point", BLUE, 12), text(F[0] - 10, F[1] + 50, "ahead they can see", BLUE, 12),
         text(Tg[0] + 6, Tg[1] + 28, "target: panFrac 0.5 along ahead", TEXT, 12, "middle"),
         text(Pl[0], Pl[1] + 36, "player", GREEN, 12, "middle"),
         text(300, 80, "far look (Space): casts to the first wall or", AMBER, 12),
         text(300, 96, "door, past the light and the outer stop", AMBER, 12),
         text(300, 132, "light sweep: the fan either side of their facing", "#c8bc90", 12)]
write("camera-follow", "following, from above: the view frames the player and their frontier", 450, body)
