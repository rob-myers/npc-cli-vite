"""Writes the symbol-generation diagrams as SVGs, styled as docs/camera's. Run from this folder."""
from html import escape

BG, BOX, EDGE, TEXT, MUTED = "#1b1d22", "#262a31", "#3a404a", "#e6e6e6", "#9aa0a6"
BLUE, GREEN, AMBER, RED, PURPLE, GREY = "#5aa0f0", "#4ec98a", "#e0b050", "#e06c6c", "#b48cf0", "#7a8290"
W = 760
FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif"


def write(name, title, height, body):
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {height}" width="{W}" height="{height}" '
        f'font-family="{FONT}" font-size="13">\n'
        f'<rect width="{W}" height="{height}" rx="10" fill="{BG}"/>\n'
        f'<text x="24" y="32" fill="{TEXT}" font-size="15" font-weight="600">{escape(title)}</text>\n'
        + "\n".join(body)
        + "\n</svg>\n"
    )
    open(f"{name}.svg", "w").write(svg)


# 303's units drawn at 0.6 px each, from (20, 56)
S, OX, OY = 0.6, 20, 56


def px(x, y):
    return f"{OX + x * S:.1f},{OY + y * S:.1f}"


def rect(x, y, w, h, fill, stroke, opacity=0.35, dash=False):
    d = ' stroke-dasharray="4 3"' if dash else ""
    return (
        f'<rect x="{OX + x * S:.1f}" y="{OY + y * S:.1f}" width="{w * S:.1f}" height="{h * S:.1f}" '
        f'fill="{fill}" fill-opacity="{opacity}" stroke="{stroke}" stroke-width="1.2"{d}/>'
    )


def poly(points, fill, stroke, opacity=0.9):
    pts = " ".join(px(x, y) for x, y in points)
    return f'<polygon points="{pts}" fill="{fill}" fill-opacity="{opacity}" stroke="{stroke}" stroke-width="1"/>'


def label(x, y, text, colour=TEXT, size=10, anchor="middle"):
    return (
        f'<text x="{OX + x * S:.1f}" y="{OY + y * S:.1f}" fill="{colour}" font-size="{size}" '
        f'text-anchor="{anchor}" dominant-baseline="middle">{escape(text)}</text>'
    )


def p303():
    """303 as built (symbol/g-303--passenger-deck.json), coloured by the milestone adding each part"""
    body = [rect(0, 0, 1200, 600, BOX, EDGE, opacity=1)]

    # the hull's own: interior walls, the two solid blocks (M1)
    walls = [
        [(960, 120), (960, 300), (1000, 300), (1080, 262), (1145, 245), (1200, 241)],
        [(240, 180), (240, 300), (198, 300), (120, 262), (55, 245), (0, 241)],
        [(0, 368), (48, 368), (104, 380), (153, 407), (193, 448), (219, 498), (233, 555), (233, 600)],
        [(300, 300), (300, 361)],
        [(900, 300), (900, 361)],
        # the exec stateroom and its fresher
        [(720, 180), (960, 180)],
        [(780, 0), (780, 120), (720, 120)],
    ]
    for pts in walls:
        body.append(
            f'<polyline points="{" ".join(px(x, y) for x, y in pts)}" fill="none" stroke="{TEXT}" stroke-width="2"/>'
        )
    for xs in [(360, 266), (840, 934)]:
        a, b = xs
        body.append(poly([(a, 360), (a, 569), (a + (b - a) * 0.3, 479), (a + (b - a) * 0.6, 411), (b, 360)], GREY, GREY))

    # symbols we have (M1)
    for x in (360, 480, 600, 720):
        body.append(rect(x, 360, 120, 240, GREEN, GREEN))
        body.append(label(x + 60, 480, "036"))
    body.append(rect(168.9, -1.7, 71.2, 61.4, GREEN, GREEN))
    body.append(label(204.5, 29, "berth"))
    for x, y in [(316, 547.5), (1147.5, 239)]:
        body.append(rect(x, y, 44, 44, GREEN, GREEN))
        body.append(label(x + 22, y + 22, "iris"))
    for x in (90, 270, 390, 510, 630, 870):
        body.append(rect(x, -6, 60, 12, GREEN, GREEN, opacity=0.8))
    for cx, cy in [(1087, 222.6), (1119, 213.5), (1153, 209), (1187.5, 206.7), (417.3, 259.6), (417.3, 299.6), (417.5, 339.6)]:
        body.append(rect(cx - 9.5, cy - 9.5, 19, 19, GREEN, GREEN, opacity=0.8))

    # M2 to M5
    for x in (240, 360, 480, 600):
        body.append(rect(x, 0, 120, 180, BLUE, BLUE))
        body.append(label(x + 60, 90, "035"))
    body.append(rect(960, 360, 240, 240, AMBER, AMBER))
    body.append(label(1080, 480, "office 089"))
    body.append(rect(960, 0, 240, 120, PURPLE, PURPLE))
    body.append(label(1080, 60, "galley 006"))
    body.append(rect(375, 240, 30, 120, PURPLE, PURPLE))
    body.append(rect(1078.5, 219.5, 120, 40, PURPLE, PURPLE))
    body.append(label(1105, 232, "bar"))
    body.append(rect(3.5, 10.1, 90, 218.8, RED, RED))
    body.append(label(48.5, 120, "beds"))
    body.append(rect(179, 59.5, 60, 120, RED, RED))
    body.append(label(209, 120, "console"))

    # labels of the hull's own
    body.append(label(637, 262, "common area", MUTED))
    body.append(label(187, 352, "corridor", MUTED))
    body.append(label(1040, 335, "corridor", MUTED))
    body.append(label(110, 490, "engineering", MUTED))
    body.append(label(870, 90, "exec SR", MUTED))
    body.append(label(750, 60, "FR", MUTED))

    # doors: hull (white), locked (red), auto (amber)
    hull = [(-4, 248, 8, 48), (-4, 304, 8, 48), (1196, 248, 8, 48), (1196, 304, 8, 48)]
    hull += [(x, 596, 48, 8) for x in (248, 304, 848, 904)]
    for d in hull:
        body.append(rect(*d, TEXT, TEXT, opacity=1))
    for d in [(127.5, 238, 44, 6), (187.5, 238, 44, 6), (8, 364.5, 46, 7), (229.5, 547, 7, 46)]:
        body.append(rect(*d, RED, RED, opacity=1))
    for d in [(237.5, 188, 6, 44), (957, 188, 6, 44), (297, 308.5, 6, 44), (897, 309, 6, 44)]:
        body.append(rect(*d, AMBER, AMBER, opacity=1))
    # plain doors of the hull's own: the exec stateroom's and its fresher's
    for d in [(787.5, 177, 45, 6), (777, 67.5, 6, 45)]:
        body.append(rect(*d, MUTED, MUTED, opacity=1))

    # legend
    y0 = OY + 600 * S + 26
    keys = [
        (GREEN, "M1 hull, its walls and doors, and what we have"),
        (BLUE, "M2 stateroom--035"),
        (AMBER, "M3 office--089"),
        (PURPLE, "M4 galley, mess bar, common-area table"),
        (RED, "M5 medical beds, console"),
    ]
    for i, (c, t) in enumerate(keys):
        x, y = 24 + (i % 2) * 360, y0 + (i // 2) * 20
        body.append(f'<rect x="{x}" y="{y - 9}" width="14" height="12" fill="{c}" fill-opacity="0.6" stroke="{c}"/>')
        body.append(f'<text x="{x + 22}" y="{y + 1}" fill="{MUTED}" font-size="12">{escape(t)}</text>')
    y = y0 + 60
    body.append(f'<rect x="24" y="{y - 9}" width="14" height="5" fill="{TEXT}"/>')
    body.append(f'<text x="46" y="{y + 1}" fill="{MUTED}" font-size="12">hull door</text>')
    body.append(f'<rect x="130" y="{y - 9}" width="14" height="5" fill="{RED}"/>')
    body.append(f'<text x="152" y="{y + 1}" fill="{MUTED}" font-size="12">locked door</text>')
    body.append(f'<rect x="250" y="{y - 9}" width="14" height="5" fill="{AMBER}"/>')
    body.append(f'<text x="272" y="{y + 1}" fill="{MUTED}" font-size="12">auto door</text>')
    body.append(f'<rect x="360" y="{y - 9}" width="14" height="5" fill="{MUTED}"/>')
    body.append(f'<text x="382" y="{y + 1}" fill="{MUTED}" font-size="12">door</text>')
    body.append(f'<rect x="440" y="{y - 9}" width="14" height="12" fill="{GREY}"/>')
    body.append(f'<text x="462" y="{y + 1}" fill="{MUTED}" font-size="12">solid block</text>')

    write("303-milestones", "g-303--passenger-deck as built, by milestone", int(y + 24), body)


p303()
