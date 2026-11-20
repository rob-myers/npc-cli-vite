import { cn, redrawForSnapshotEvent, tw } from "@npc-cli/util";

/** Renders a tab's drag preview: its title over a thumbnail of its content, else a blank one. */
export function renderTabDragPreview(
  container: HTMLElement,
  { title, kind }: { title: string; kind: string },
  content: HTMLElement | null,
) {
  const card = document.createElement("div");
  card.className = cardClass;
  card.style.width = `${previewWidth}px`;

  const label = document.createElement("div");
  label.className = labelClass;
  label.textContent = title;
  card.appendChild(label);
  container.appendChild(card);

  const rect = content?.getBoundingClientRect();
  if (content && rect && rect.width > 0 && rect.height > 0) {
    thumbnailInto(card, content, rect);
  } else if (content) {
    placeholderInto(card, content, kind);
  }
}

/** Appends a blank thumbnail for a hidden tab, shaped like its pane and in its theme. */
function placeholderInto(card: HTMLElement, content: HTMLElement, kind: string) {
  const pane = content.parentElement?.getBoundingClientRect();
  const aspect = pane && pane.width > 0 && pane.height > 0 ? pane.height / pane.width : 9 / 16;
  const thumb = document.createElement("div");
  thumb.className = cn(blankThumbClass, ...Array.from(content.classList).filter((c) => c.startsWith("theme-")));
  thumb.style.height = `${Math.round(Math.min(previewWidth * aspect, maxThumbHeight))}px`;
  const inset = document.createElement("div");
  inset.className = blankInsetClass;
  inset.style.backgroundImage = hatch;
  inset.textContent = kind;
  thumb.appendChild(inset);
  card.appendChild(thumb);
}

/** Appends a clone of `content` scaled to fit, its canvases copied and its scroll kept. */
function thumbnailInto(card: HTMLElement, content: HTMLElement, rect: DOMRect) {
  const scale = Math.min(previewWidth / rect.width, maxThumbHeight / rect.height);
  const thumb = document.createElement("div");
  thumb.className = thumbClass;
  thumb.style.height = `${Math.round(rect.height * scale)}px`;

  const frame = document.createElement("div");
  frame.className = frameClass;
  Object.assign(frame.style, { width: `${rect.width * scale}px`, height: `${rect.height * scale}px` });

  const inner = document.createElement("div");
  inner.className = stillClass;
  Object.assign(inner.style, {
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    transform: `scale(${scale})`,
    transformOrigin: "0 0",
  });

  const clone = content.cloneNode(true) as HTMLElement;
  clone.removeAttribute("data-tab-content");
  Object.assign(clone.style, { width: "100%", height: "100%" });

  const srcs = Array.from(content.querySelectorAll<HTMLElement>("*"));
  const dsts = Array.from(clone.querySelectorAll<HTMLElement>("*"));
  const scrolled: [HTMLElement, HTMLElement][] = [];

  srcs.forEach((src, i) => {
    const dst = dsts[i];
    if (!dst) return;
    if (src instanceof HTMLCanvasElement) dst.replaceWith(copyCanvas(src, scale));
    else if (src.matches(unclonedSelector)) dst.replaceWith(placeholderOf(src));
    else if (src.scrollTop || src.scrollLeft) scrolled.push([src, dst]);
  });

  inner.appendChild(clone);
  frame.appendChild(inner);
  thumb.appendChild(frame);
  card.appendChild(thumb);

  for (const [src, dst] of scrolled) {
    dst.scrollTop = src.scrollTop;
    dst.scrollLeft = src.scrollLeft;
  }
}

/** A 2D copy of `src` at thumbnail resolution, blank if it cannot be read. */
function copyCanvas(src: HTMLCanvasElement, scale: number) {
  const dst = document.createElement("canvas");
  const { clientWidth: w, clientHeight: h } = src;
  dst.className = src.className;
  dst.style.cssText = src.style.cssText;
  Object.assign(dst.style, { width: `${w}px`, height: `${h}px` });
  if (w === 0 || h === 0) return dst;
  dst.width = Math.max(1, Math.round(w * scale * devicePixelRatio));
  dst.height = Math.max(1, Math.round(h * scale * devicePixelRatio));
  try {
    src.dispatchEvent(new Event(redrawForSnapshotEvent));
    dst.getContext("2d")?.drawImage(src, 0, 0, dst.width, dst.height);
  } catch {}
  return dst;
}

/** An empty box the size of `src`, so its clone never loads anything. */
function placeholderOf(src: HTMLElement) {
  const box = document.createElement("div");
  Object.assign(box.style, { width: `${src.clientWidth}px`, height: `${src.clientHeight}px` });
  box.className = placeholderClass;
  return box;
}

/** Within 280px with its offset, else Windows fades it. */
const previewWidth = 200;
const maxThumbHeight = 140;
const unclonedSelector = "iframe, video, audio, object, embed";

const cardClass = tw(
  "overflow-hidden rounded-md border border-on-background/30 bg-background text-on-background font-mono",
);
const labelClass = tw("px-2 py-1 text-xs truncate border-b border-on-background/20");
const thumbClass = tw("flex justify-center overflow-hidden pointer-events-none bg-on-background/5");
const frameClass = tw("shrink-0 overflow-hidden");
/** No transitions or animations, else what fades in (e.g. `starting:opacity-0`) is captured unseen. */
const stillClass = tw("[&_*]:transition-none! [&_*]:animate-none!");
const placeholderClass = tw("bg-on-background/10");
const blankThumbClass = tw("p-1.5 bg-background text-on-background/45");
const blankInsetClass = tw(
  "size-full grid place-items-center rounded border border-on-background/20 text-xs uppercase tracking-widest",
);
/** Faint diagonal lines, so a blank thumbnail reads as not live. */
const hatch =
  "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, currentColor 25%, transparent) 6px 7px)";
