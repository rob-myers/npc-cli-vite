/**
 * Draw opaque part of `image` in colour `fillColour`
 * @param {HTMLImageElement | HTMLCanvasElement} image
 * @param {CanvasRenderingContext2D} ctxt
 * @param {string} fillColor
 */
function createMonochromeMask(image, ctxt, fillColor) {
  ctxt.canvas.width = image.width;
  ctxt.canvas.height = image.height;
  ctxt.globalCompositeOperation = "source-over";
  ctxt.drawImage(/** @type {*} */ (image), 0, 0);
  ctxt.globalCompositeOperation = "source-in";
  ctxt.fillStyle = fillColor;
  ctxt.fillRect(0, 0, image.width, image.height);
  ctxt.globalCompositeOperation = "source-over";
}

/**
 * Invert `canvas`, overwriting it, while also preserving alpha=0.
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasRenderingContext2D} copyCtxt
 * This will contain a copy of `canvas`.
 * @param {CanvasRenderingContext2D} maskCtxt
 * This will contain a monochrome mask (preserving alpha=0)
 */
export function invertCanvas(canvas, copyCtxt, maskCtxt) {
  const dstCtxt = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));

  copyCtxt.canvas.width = canvas.width;
  copyCtxt.canvas.height = canvas.height;
  copyCtxt.drawImage(canvas, 0, 0);

  createMonochromeMask(copyCtxt.canvas, maskCtxt, "#ffffff");

  // Take difference to obtain inverted image
  dstCtxt.globalCompositeOperation = "difference";
  dstCtxt.drawImage(maskCtxt.canvas, 0, 0);
  dstCtxt.globalCompositeOperation = "source-over";
}

/**
 * https://stackoverflow.com/a/4819886/2917822
 * ℹ️ If Chrome devtool initially open as mobile device,
 * `'ontouchstart' in window` continues to be true if switch to desktop.
 */
export function isTouchDevice() {
  return (
    typeof window !== "undefined" &&
    ("ontouchstart" in window || navigator.maxTouchPoints > 0 || /** @type {*} */ (navigator).msMaxTouchPoints > 0)
  );
}

/**
 * @param {string} text
 * @param {SpeechSynthesisVoice} [voice]
 */
export async function speak(text, voice) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice ?? null;
  await new Promise((resolve, reject) => {
    // utterance.onend = resolve;
    utterance.onend = () => setTimeout(resolve, 100);
    utterance.onerror = () => reject(Error("utterance failed or stopped"));
    window.speechSynthesis.speak(utterance);
  });
}
