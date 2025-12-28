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
