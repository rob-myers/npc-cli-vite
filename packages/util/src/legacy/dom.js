/**
 * https://stackoverflow.com/a/4819886/2917822
 * ℹ️ If Chrome devtool initially open as mobile device,
 * `'ontouchstart' in window` continues to be true if switch to desktop.
 */
export function isTouchDevice() {
  return (
    typeof window !== "undefined" &&
    ("ontouchstart" in window ||
      navigator.maxTouchPoints > 0 ||
      /** @type {*} */ (navigator).msMaxTouchPoints > 0)
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
