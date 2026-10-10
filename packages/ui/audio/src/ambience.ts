/** A generative ship ambience: a synthesised engine drone and air handling, under a sampled choir */

export const ambienceDefaults = {
  master: 0.6,
  drone: 0.5,
  /** The engine's pitch, which the choir's chords are built on */
  droneHz: 36.7,
  droneCutoff: 140,
  air: 0.3,
  airHz: 700,
  choir: 0.6,
  /** How much of the choir is heard directly, beside its reverb */
  choirDry: 0.5,
  choirCutoff: 2400,
  /** In semitones */
  choirTranspose: 0,
  /** A random bend per note, in cents either way */
  choirDetune: 0,
  /** How many of a chord's four notes are sung, from the lowest */
  voices: 4,
  /** How far apart the voices stand, `1` being hard left and right */
  spread: 0.6,
  chordSecs: 18,
  /** The chance a voice sits a chord out */
  rest: 0.25,
  /** The longest a voice may enter late, in seconds */
  stagger: 3,
  attack: 3,
  release: 5,
  /** A note is a chain of overlapping stretches of its sample, each this long */
  grain: 5,
  /** How long neighbouring stretches overlap */
  crossfade: 1.8,
  reverb: 0.7,
};

export type AmbienceConfig = typeof ambienceDefaults;
export type AmbienceKey = keyof AmbienceConfig;

/** Each slider's `[min, max, step]` */
export const ambienceRanges: Record<AmbienceKey, [number, number, number]> = {
  master: [0, 1, 0.01],
  drone: [0, 1, 0.01],
  droneHz: [25, 60, 0.1],
  droneCutoff: [60, 400, 1],
  air: [0, 1, 0.01],
  airHz: [200, 3000, 10],
  choir: [0, 1, 0.01],
  choirDry: [0, 1, 0.01],
  choirCutoff: [600, 5000, 10],
  choirTranspose: [-24, 12, 1],
  choirDetune: [0, 50, 1],
  voices: [1, 4, 1],
  spread: [0, 1, 0.01],
  chordSecs: [6, 40, 1],
  rest: [0, 0.8, 0.01],
  stagger: [0, 10, 0.1],
  attack: [0.1, 10, 0.1],
  release: [0.5, 15, 0.1],
  grain: [1, 6, 0.1],
  crossfade: [0.1, 3, 0.1],
  reverb: [0, 1, 0.01],
};

/** Minor chords and their neighbours, in semitones above the drone */
const chords = [
  [24, 31, 36, 39],
  [20, 27, 32, 36],
  [17, 24, 29, 32],
  [15, 22, 27, 31],
  [22, 29, 34, 38],
  [19, 26, 31, 36],
];

/** Where the choir's notes are served from — see its README for their source */
const choirUrl = "/audio/choir/";
/** The notes sampled, as MIDI numbers: a minor third apart, so none is bent by more than a semitone */
const choirMidis = [43, 46, 49, 52, 55, 58, 61, 64];
/** The steady stretch of each sample, in seconds */
const choirSustain = [0.2, 6.7];

/** Where each voice stands at full `spread` */
const voicePans = [-1, 0.4, -0.35, 1];
const fadeInSecs = 4;
const fadeOutSecs = 1.5;

export function createAmbience(initial: Partial<AmbienceConfig> = {}) {
  const config = { ...ambienceDefaults, ...initial };
  const ctx = new AudioContext();
  const now = () => ctx.currentTime;

  const gain = (value: number) => {
    const node = ctx.createGain();
    node.gain.value = value;
    return node;
  };
  const filter = (type: BiquadFilterType, hz: number, q = 0.7) => {
    const node = ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = hz;
    node.Q.value = q;
    return node;
  };
  const osc = (type: OscillatorType, hz: number, cents = 0) => {
    const node = ctx.createOscillator();
    node.type = type;
    node.frequency.value = hz;
    node.detune.value = cents;
    node.start();
    return node;
  };
  /** Sways `param` by `depth` either way */
  const lfo = (hz: number, depth: number, ...params: AudioParam[]) => {
    const amount = gain(depth);
    osc("sine", hz).connect(amount);
    for (const param of params) amount.connect(param);
    return amount;
  };

  const master = gain(0);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  master.connect(ctx.createDynamicsCompressor()).connect(analyser).connect(ctx.destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = createImpulse(ctx, 6);
  const wet = gain(config.reverb);
  reverb.connect(wet).connect(master);

  const noise = ctx.createBufferSource();
  noise.buffer = createPinkNoise(ctx, 5);
  noise.loop = true;
  noise.start();

  // engine drone
  const droneOut = gain(config.drone);
  const droneLow = filter("lowpass", config.droneCutoff);
  /** Each oscillator's multiple of `droneHz` */
  const droneParts: [OscillatorNode, number][] = [
    [osc("sawtooth", config.droneHz), 1],
    [osc("sawtooth", config.droneHz, 9), 1],
    [osc("sine", config.droneHz * 2, -5), 2],
  ];
  const droneMix = gain(0.3);
  for (const [node] of droneParts) node.connect(droneMix);
  noise.connect(filter("lowpass", 70)).connect(gain(2)).connect(droneMix);
  droneMix.connect(droneLow).connect(droneOut).connect(master);
  droneOut.connect(gain(0.15)).connect(reverb);
  lfo(0.06, 0.08, droneMix.gain);

  // air handling
  const airOut = gain(config.air);
  const airBand = filter("bandpass", config.airHz, 0.6);
  const airMix = gain(0.9);
  noise.connect(airBand).connect(airMix).connect(airOut).connect(master);
  airOut.connect(gain(0.2)).connect(reverb);
  lfo(0.05, 0.25, airMix.gain);
  lfo(0.031, 120, airBand.frequency);

  // choir
  const choirOut = gain(config.choir);
  const choirLow = filter("lowpass", config.choirCutoff);
  choirLow.connect(choirOut);
  const choirDry = gain(config.choirDry);
  choirOut.connect(choirDry).connect(master);
  choirOut.connect(reverb);

  /** A tap per channel, for the desk's level meters */
  const meter = (source: AudioNode) => {
    const node = ctx.createAnalyser();
    node.fftSize = 1024;
    source.connect(node);
    return node;
  };
  const meters = { drone: meter(droneOut), air: meter(airOut), choir: meter(choirOut), master: meter(analyser) };

  let samples: { midi: number; buffer: AudioBuffer }[] = [];
  Promise.all(
    choirMidis.map(async (midi) => {
      const response = await fetch(`${choirUrl}${midi}.mp3`);
      return { midi, buffer: await ctx.decodeAudioData(await response.arrayBuffer()) };
    }),
  )
    .then((loaded) => void (samples = loaded))
    .catch((e) => ctx.state !== "closed" && console.error("ambience: choir samples failed to load", e));

  /** One voice holding `hz` from `at` for `secs`, bent from the nearest sample */
  function sing(hz: number, at: number, secs: number, level: number, pan: number) {
    const midi = 69 + 12 * Math.log2(hz / 440) + ((Math.random() * 2 - 1) * config.choirDetune) / 100;
    const attack = Math.min(config.attack, secs / 2);
    const release = Math.min(config.release, secs / 2);
    const sample = samples.reduce((best, next) =>
      Math.abs(next.midi - midi) < Math.abs(best.midi - midi) ? next : best,
    );
    const rate = 2 ** ((midi - sample.midi) / 12);
    /** Shortened where a note bent upwards would run off its sample */
    const grainSecs = Math.min(config.grain, (choirSustain[1] - choirSustain[0]) / rate);
    // under half the stretch, so each still advances
    const grainFadeSecs = Math.min(config.crossfade, grainSecs / 2 - 0.05);

    const out = gain(0);
    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(level, at + attack);
    out.gain.setValueAtTime(level, at + secs - release);
    out.gain.linearRampToValueAtTime(0, at + secs);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner).connect(choirLow);

    for (let t = at; t < at + secs; t += grainSecs - grainFadeSecs) {
      const source = ctx.createBufferSource();
      source.buffer = sample.buffer;
      source.playbackRate.value = rate;
      const envelope = gain(0);
      envelope.gain.setValueAtTime(0, t);
      envelope.gain.linearRampToValueAtTime(1, t + grainFadeSecs);
      envelope.gain.setValueAtTime(1, t + grainSecs - grainFadeSecs);
      envelope.gain.linearRampToValueAtTime(0, t + grainSecs);
      source.connect(envelope).connect(out);
      const span = choirSustain[1] - choirSustain[0] - grainSecs * rate;
      source.start(t, choirSustain[0] + Math.random() * Math.max(0, span));
      source.stop(t + grainSecs);
    }
  }

  let lastChord = -1;
  function scheduleChord(at: number, secs: number) {
    if (samples.length === 0) return;
    let next = Math.floor(Math.random() * (chords.length - 1));
    if (next >= lastChord) next++;
    lastChord = next;

    voicePans.slice(0, config.voices).forEach((pan, i) => {
      if (Math.random() < config.rest) return;
      const hz = config.droneHz * 2 ** ((chords[next][i] + config.choirTranspose) / 12);
      // each lingers into the next chord
      const length = secs + config.release;
      sing(hz, at + Math.random() * config.stagger, length, 0.6 + Math.random() * 0.4, pan * config.spread);
    });
  }

  let nextChordAt = now() + 0.2;
  const timer = window.setInterval(() => {
    // the clock stands still whilst suspended, so nothing is scheduled then
    if (now() < nextChordAt - 2) return;
    const secs = config.chordSecs * (0.8 + Math.random() * 0.4);
    scheduleChord(nextChordAt, secs);
    nextChordAt += secs;
  }, 500);

  master.gain.setTargetAtTime(config.master, now(), fadeInSecs / 3);

  return {
    ctx,
    analyser,
    meters,
    config,
    /** The mix and the filters change at once. The rest is read as the next chord is chosen */
    set(partial: Partial<AmbienceConfig>) {
      Object.assign(config, partial);
      const ease = (param: AudioParam, value: number) => param.setTargetAtTime(value, now(), 0.05);
      ease(master.gain, config.master);
      ease(droneOut.gain, config.drone);
      ease(droneLow.frequency, config.droneCutoff);
      for (const [node, multiple] of droneParts) ease(node.frequency, config.droneHz * multiple);
      ease(airOut.gain, config.air);
      ease(airBand.frequency, config.airHz);
      ease(choirOut.gain, config.choir);
      ease(choirDry.gain, config.choirDry);
      ease(choirLow.frequency, config.choirCutoff);
      ease(wet.gain, config.reverb);
    },
    /** Fades out, then closes the context */
    stop() {
      window.clearInterval(timer);
      master.gain.cancelScheduledValues(now());
      master.gain.setTargetAtTime(0, now(), fadeOutSecs / 4);
      window.setTimeout(() => void ctx.close(), fadeOutSecs * 1000);
    },
  };
}

export type Ambience = ReturnType<typeof createAmbience>;
export type AmbienceMeterKey = keyof Ambience["meters"];

/** A looping buffer of pink noise (Paul Kellet's economy filter) */
function createPinkNoise(ctx: BaseAudioContext, secs: number) {
  const buffer = ctx.createBuffer(1, secs * ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.12;
  }
  return buffer;
}

/** A large dark hall: decaying noise, duller as it dies */
function createImpulse(ctx: BaseAudioContext, secs: number) {
  const length = secs * ctx.sampleRate;
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      low += (Math.random() * 2 - 1 - low) * (0.5 - 0.4 * t);
      data[i] = low * (1 - t) ** 3;
    }
  }
  return buffer;
}
