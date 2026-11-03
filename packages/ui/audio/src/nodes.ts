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
  return ctx.decodeAudioData(await fetchBytes(url));
}

/** A file's bytes, undecoded */
export async function fetchBytes(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`${response.status} ${url}`);
  return response.arrayBuffer();
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

/** A small hard room, as a ship's: a convolver over noise dying away */
export function room(ctx: BaseAudioContext) {
  const node = ctx.createConvolver();
  node.buffer = getRoomImpulse(ctx);
  return node;
}

const roomImpulses = new WeakMap<BaseAudioContext, AudioBuffer>();

/** `roomSecs` of stereo noise dying away, made once per context */
function getRoomImpulse(ctx: BaseAudioContext) {
  const cached = roomImpulses.get(ctx);
  if (cached !== undefined) return cached;
  const length = Math.round(ctx.sampleRate * roomSecs);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp((-roomDecay * i) / length);
  }
  roomImpulses.set(ctx, buffer);
  return buffer;
}

const roomSecs = 0.45;
/** How fast the room dies, over its length */
const roomDecay = 7;

/** A vast stone hall, as a monk chants in: a convolver over noise dying away slowly, and darker as it dies */
export function hall(ctx: BaseAudioContext) {
  const node = ctx.createConvolver();
  node.buffer = getHallImpulse(ctx);
  return node;
}

const hallImpulses = new WeakMap<BaseAudioContext, AudioBuffer>();

/** `hallSecs` of stereo noise dying away, losing its highs first as stone does, made once per context */
function getHallImpulse(ctx: BaseAudioContext) {
  const cached = hallImpulses.get(ctx);
  if (cached !== undefined) return cached;
  const length = Math.round(ctx.sampleRate * hallSecs);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let dark = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // a lowpass closing as it dies
      dark += (Math.random() * 2 - 1 - dark) * (hallBright * (1 - t) + hallDull * t);
      data[i] = dark * Math.exp(-hallDecay * t);
    }
  }
  hallImpulses.set(ctx, buffer);
  return buffer;
}

const hallSecs = 9;
/** How fast the hall dies, over its length */
const hallDecay = 6;
/** How bright the hall is as it starts, and as it ends: a lowpass step from `0` to `1` */
const hallBright = 0.9;
const hallDull = 0.04;
