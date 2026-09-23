# Screen slideshows

How a screen recording becomes a looping slideshow for the README: a handful of stills, each held a couple
of seconds, as an animated WebP. Two ways to choose the stills:

- **By camera view** — one per distinct zoom or angle (`initial-vid-1.webp`, `initial-vid-2.webp`).
- **By action** — one per click or key press, found via Keystro (`initial-vid-3.webp`). Better: each frame
  shows something happening, and the box in it says what.

## Why WebP, and why no fades

- **Animated WebP, not GIF.** It animates in a plain `<img>`, GitHub included, is full colour rather than
  256, and came out a sixth of the GIF's size. A video in the repo is not played inline by GitHub; only one
  uploaded through its web editor (a `user-attachments` url) is.
- **Cut, don't crossfade.** Every fade frame is a whole new image, and lossy WebP blotches the dark, flat,
  colour-fringed scenes badly — per-frame quality, keyframe-only encoding and q90–100 all left fades
  blotchy. Straight cuts at q90 are clean and small.
- **ffmpeg alone is enough for cuts.** Its `libwebp_anim` stores a frame as a lossy patch over the last,
  which blotched the fades — but between distinct stills nearly every pixel changes anyway. libwebp's
  `img2webp` is the fallback if blotches return.

Tools: `ffmpeg`/`ffprobe` and ImageMagick (`magick`); `img2webp` only as a fallback (installed at
`~/coding/libs/libwebp-1.6.0-mac-x86-64/bin`). Work from `docs/screenshots`; `$S` is any scratch dir.

**First, turn the `.mov` into an `.mp4`** and work from that — H.264 at CRF 18 is visually lossless at a
tenth of the size (`initial-vid-3`: 125 MB → 12.6 MB, SSIM 0.999). Keep the mp4, not the mov. The top
line is blackened here too — see "Extract and encode".

```sh
ffmpeg -v error -y -i in.mov -vf "drawbox=x=0:y=0:w=iw:h=4:color=black:t=fill" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart -an in.mp4
ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate -of default=nw=1 in.mp4
```

The commands below say `in.mov`; the mp4 works the same.

## Choosing stills by action — Keystro

Record with **Keystro** on. Whilst anything is pressed it draws a white box, bottom centre, showing the
mouse (pressed button shaded) and any held keys. The macOS click ring alone was not enough: a thin
dull-grey circle, easily confused with the grey edges sweeping past whenever the camera moves.

**1. Crop the box's band**, 20 frames a second. The crop is in full-res pixels, for a 3948×2304
recording — check it on a frame first, as a different window size moves it.

```sh
mkdir -p $S/ks && ffmpeg -v error -i in.mov -vf "fps=20,crop=1150:125:1400:2095,format=gray" $S/ks/%04d.png
```

**2. Measure each frame**: the share of near-white pixels, and the span of columns more than half white —
the box's width, which changes with its keys. From `scripts/` (for `skia-canvas`):

```sh
cat > .keystro.mjs <<'EOF'
import fs from "node:fs";
import { Canvas, loadImage } from "skia-canvas";
const dir = process.argv[2], fps = 20;
for (const [i, f] of fs.readdirSync(dir).sort().entries()) {
  const im = await loadImage(`${dir}/${f}`);
  const c = new Canvas(im.width, im.height), ct = c.getContext("2d");
  ct.drawImage(im, 0, 0);
  const d = ct.getImageData(0, 0, im.width, im.height).data;
  let white = 0, x0 = im.width, x1 = -1;
  for (let x = 0; x < im.width; x++) {
    let col = 0;
    for (let y = 0; y < im.height; y++) if (d[(y * im.width + x) * 4] > 235) col++;
    white += col;
    if (col > im.height * 0.5) { x0 = Math.min(x0, x); x1 = x; }
  }
  console.log(`${(i / fps).toFixed(2)} ${(white / (im.width * im.height)).toFixed(3)} ${x1 < 0 ? "-" : `${x0}-${x1}`}`);
}
EOF
node .keystro.mjs $S/ks > $S/keystro.txt; rm .keystro.mjs
```

**3. Group into stretches** — frames with the box showing, one stretch per action. The cut-off is
**0.02**: a plain click's box is narrow (~0.04 of the strip), so anything higher drops every click
without a key. A new width within a stretch is a new combination (`ctrl` → `ctrl C` → `ctrl C ↑`).

```sh
awk '
{ on = ($2 > 0.02) }
on && (!prevOn || $3 != prevKey) { if (n) print start, last, prevKey; start = $1; n = 1 }
on { last = $1 }
!on && prevOn { print start, last, prevKey; n = 0 }
{ prevOn = on; prevKey = $3 }
END { if (prevOn) print start, last, prevKey }
' $S/keystro.txt
```

**4. Pick a time per stretch — at the END of its fullest (widest) combination**, so the action has had
its effect and the box shows all of it. The very last frame of a stretch can show only a key still held,
e.g. `Shift` after the click. Brief entries (0.05–0.25s) are usually a modifier going down first; fold them
into the stretch they lead. Start with the opening frame, `0`, even with a menu open.

`initial-vid-3` (38s, 12 clicks and 7 key combinations) used
`0 1.25 4.25 7.35 11.55 13.85 16.6 18.15 20.1 21.85 23.45 25 27.45 28.7 30.95 33.85 34.85 35.8 37.8 38.65`.

Then extract and encode as below, holding each 2s given so many — 20 frames, 0.53 MB.

## Choosing stills by camera view

**1. Find where the camera rests.** A scene score per sample: runs of `0.000` are the camera at rest,
blips are it moving. Slow moves score low, so confirm with step 2.

```sh
ffmpeg -v error -i in.mov -vf "fps=5,scale=320:-1,select='gte(scene,0)',metadata=print:file=-" -f null - \
  | awk '/pts_time/{split($0,a,"pts_time:"); t=a[2]} /scene_score/{split($0,b,"="); printf "%.1f %s\n", t, b[2]}'
```

**2. Contact sheet**, one frame per second, timestamped:

```sh
ffmpeg -v error -y -i in.mov -vf "fps=1,scale=400:-1,drawtext=text='%{pts\:hms}':x=8:y=8:fontsize=28:fontcolor=yellow:box=1:boxcolor=black,tile=6x8" -frames:v 1 $S/contact.png
```

**3. Pick a time per distinct zoom or angle**, inside a resting run, skipping near-repeats.
`initial-vid-1` used `0 5 14 15 17 18 20.5`; `initial-vid-2` used `2 12 18.5 23.5 29 37`.

## Extract and encode

**1. Extract the stills**, scaled for the README (shown at 800px, so 1200px stays sharp), listing each
with how long it is held. Chrome's navbar colour leaves a light line along the top of a recording — 4
rows at 3948×2304 — so paint it black first, at full res (check the rows: `magick f.png -crop 3948x1+0+3
+repage -format "%[fx:mean*255]" info:`):

```sh
rm -f $S/views.txt; i=0; for t in 0 1.25 4.25; do  # your times
  f=$S/view-$(printf %02d $i).png
  ffmpeg -v error -y -ss $t -i in.mov -frames:v 1 -vf "drawbox=x=0:y=0:w=iw:h=4:color=black:t=fill,scale=1200:-1:flags=lanczos" $f
  printf "file '%s'\nduration 2\n" $f >> $S/views.txt; i=$((i+1))
done
```

Do NOT repeat the last file at the end of the list, as the concat demuxer usually wants: the WebP merges
it into the last frame, holding it twice as long.

**2. Encode**, looping forever:

```sh
ffmpeg -v error -y -f concat -safe 0 -i $S/views.txt -fps_mode vfr -c:v libwebp_anim -quality 90 -loop 0 out.webp
```

Blotchy? Fall back to `img2webp`, every frame a keyframe:

```sh
args="-loop 0 -kmax 0 -sharp_yuv"
for f in $S/view-*.png; do args="$args -lossy -q 90 -m 6 -exact -d 2000 $f"; done
img2webp $args -o out.webp
```

and if even that blotches, `-lossless` in place of `-lossy -q 90` — about 360 KB a frame at 1200px.

## Checking

- `magick identify -format "%T " out.webp` lists each frame's duration in centiseconds.
- Pull frames out with `magick out.webp -coalesce $S/f-%02d.png`. Without `-coalesce` you get the raw
  patches, which show white blotches that are not in the file.
- Don't commit the `.mov` — a 20–40s recording is ~120–200 MB.
