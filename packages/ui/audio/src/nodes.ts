/** Builders of Web Audio nodes, shared by the footsteps and the sound effects */

export function gain(ctx: BaseAudioContext, value: number) {
  const node = ctx.createGain();
  node.gain.value = value;
  return node;
}

export function filter(ctx: BaseAudioContext, type: BiquadFilterType, hz: number, q = 0.7) {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = hz;
  node.Q.value = q;
  return node;
}

export function osc(ctx: BaseAudioContext, type: OscillatorType, hz: number) {
  const node = ctx.createOscillator();
  node.type = type;
  node.frequency.value = hz;
  return node;
}

export function panner(ctx: BaseAudioContext, pan: number) {
  const node = ctx.createStereoPanner();
  node.pan.value = Math.max(-1, Math.min(1, pan));
  return node;
}

/** A compressor that only catches peaks, so the mix keeps its level */
export function limiter(ctx: BaseAudioContext) {
  const node = ctx.createDynamicsCompressor();
  node.threshold.value = -6;
  node.knee.value = 0;
  node.ratio.value = 20;
  node.attack.value = 0.003;
  node.release.value = 0.25;
  return node;
}

export async function loadBuffer(ctx: BaseAudioContext, url: string) {
  const response = await fetch(url);
  return ctx.decodeAudioData(await response.arrayBuffer());
}

const pinkNoise = new WeakMap<BaseAudioContext, AudioBuffer>();

/** A second of pink noise (Paul Kellet's economy filter), made once per context */
export function getPinkNoise(ctx: BaseAudioContext) {
  const cached = pinkNoise.get(ctx);
  if (cached !== undefined) return cached;
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let [b0, b1, b2] = [0, 0, 0];
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.12;
  }
  pinkNoise.set(ctx, buffer);
  return buffer;
}
