import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  abs,
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cross,
  Discard,
  Fn,
  float,
  floor,
  fract,
  hash,
  max,
  mix,
  mod,
  normalize,
  positionLocal,
  screenSize,
  sin,
  smoothstep,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { type PhaserUniforms, type PhaserView, seenBy } from "./phaser.shader";
import { varyingAs } from "./tsl";

export const MAX_BEAM_SEGMENTS = 512;

export type BeamResources = ReturnType<typeof createBeamResources>;

/** One instance per beam segment shown, from its start to its end, with its ball there */
export function createBeamResources() {
  const { sides, segments } = beamShaderConfig;
  /** Its start and eased shown, its end and eased locked */
  const srcData = new Float32Array(MAX_BEAM_SEGMENTS * 4);
  const dstData = new Float32Array(MAX_BEAM_SEGMENTS * 4);
  /** Each end's npc's room slot, then whether they are lit — they fade with it as the npcs do */
  const roomData = new Float32Array(MAX_BEAM_SEGMENTS * 4);
  /** Its style's index in `beamStyles`, its seed, the charge its shot was fired with, and `1` if its end is lit */
  const lookData = new Float32Array(MAX_BEAM_SEGMENTS * 4);
  /** Its colour, and its width's scale */
  const colorData = new Float32Array(MAX_BEAM_SEGMENTS * 4);
  const attrs = [srcData, dstData, roomData, lookData, colorData].map((data) =>
    new THREE.InstancedBufferAttribute(data, data.length / MAX_BEAM_SEGMENTS).setUsage(THREE.DynamicDrawUsage),
  );

  /** A ribbon: `x` across it, `y + 0.5` how far along the beam */
  const beam = new THREE.PlaneGeometry(1, 1, 1, segments);
  const ball = new THREE.SphereGeometry(1, sides * 2, sides);
  const base = mergeGeometries([beam, ball], true); // a group apiece: beam, then ball

  const geo = new THREE.InstancedBufferGeometry();
  for (const key of ["position", "normal", "uv"]) geo.setAttribute(key, base.getAttribute(key));
  geo.setIndex(base.getIndex());
  for (const { start, count, materialIndex } of base.groups) geo.addGroup(start, count, materialIndex);
  ["beamSrc", "beamDst", "beamRooms", "beamLook", "beamColor"].forEach((key, i) => geo.setAttribute(key, attrs[i]));
  geo.instanceCount = 0;

  // additive, glowing over a dark floor — `Phasers.syncTheme` lays them over a pale one instead
  const glowOpts = { depthWrite: false, forceSinglePass: true, blending: THREE.AdditiveBlending };
  const mats = [
    new THREE.MeshBasicNodeMaterial({ transparent: true, ...glowOpts, side: THREE.DoubleSide }),
    // seen through whomever it is in, e.g. a body part targeted from their far side
    new THREE.MeshBasicNodeMaterial({ transparent: true, ...glowOpts, depthTest: false }),
  ];
  const mesh = new THREE.Mesh(geo, mats);
  mesh.frustumCulled = false;
  mesh.renderOrder = +5;

  return { mesh, mats, attrs, srcData, dstData, roomData, lookData, colorData };
}

type F = THREE.Node<"float">;

/** The beam's nodes, else with `tip` its end's ball */
export function beamNodes({ phase, gain, faint }: PhaserUniforms, view: PhaserView, tip: boolean) {
  const cfg = beamShaderConfig;
  const src = attribute<"vec4">("beamSrc", "vec4");
  const dst = attribute<"vec4">("beamDst", "vec4");
  const [shown, locked] = [src.w, dst.w];
  const look = attribute<"vec4">("beamLook", "vec4");
  /** The charge it was fired with */
  const fired = look.z;
  const widen = fired.mul(cfg.chargeWiden).add(1);
  const tint = attribute<"vec4">("beamColor", "vec4");
  const t = tip ? float(1) : (positionLocal.y.add(0.5) as F);
  const d = dst.xyz.sub(src.xyz);
  const len = d.length();

  /** `1` if its style is `beamStyles[k]`, else `0` */
  const is = (k: number) => abs(look.x.sub(k)).lessThan(0.5).select(1, 0) as F;
  const jagged = is(1).add(is(2)); // lightning, tesla
  const crackling = is(3);
  const bolted = is(4);
  /** Redrawn `hz` times a game second: wrapped, so a float keeps it exact */
  const tickOf = (hz: number) => mod(floor(phase.mul(hz)), 4096) as F;

  let p: THREE.Node<"vec3">;
  if (tip) {
    const side = normalize(vec3(d.z.negate(), 0, d.x).add(vec3(1e-4, 0, 0)));
    const normal = normalize(cross(side, d));
    const across = side.mul(positionLocal.x).add(normal.mul(positionLocal.z));
    const r = locked.mul(cfg.tipRadius).mul(look.w).mul(widen);
    p = dst.xyz.add(across.add(normalize(d).mul(positionLocal.y)).mul(r).mul(shown)) as THREE.Node<"vec3">;
  } else {
    const c = mix(src.xyz, dst.xyz, t);
    const dir = normalize(d.add(vec3(0, 1e-5, 0)));
    /** Across the beam as seen, so the ribbon faces the camera */
    const side = normalize(cross(dir, cameraPosition.sub(c)).add(vec3(1e-5, 0, 0)));

    // lightning: a sideways offset, piecewise linear between hashed knots, pinned at both ends
    const seed = look.y.mul(1009).add(tickOf(cfg.jagHz).mul(7919));
    const noise = (knots: number, salt: number) => {
      const n = t.mul(knots);
      const i = floor(n);
      return mix(hash(seed.add(i).add(salt)), hash(seed.add(i).add(salt + 1)), fract(n)).sub(0.5);
    };
    const amp = len
      .mul(cfg.jagPerMetre)
      .min(cfg.jagMax)
      .mul(sin(t.mul(Math.PI)));
    const jag = noise(cfg.jagKnots, 0).add(noise(cfg.segments, 50000).mul(0.35)).mul(amp).mul(jagged);

    // static: its width flickers along it
    const flick = hash(floor(t.mul(cfg.segments)).add(tickOf(cfg.staticHz).mul(131)).add(look.y.mul(17)));
    const crackle = mix(float(1), flick.mul(1.4).add(0.3), crackling);
    const thin = mix(float(1), float(cfg.jagWidth), jagged);

    /** Pixels per metre across it, where it is */
    const clip = (q: THREE.Node<"vec3">) => cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(q, 1)));
    const [a0, a1] = [clip(c as THREE.Node<"vec3">), clip(c.add(side) as THREE.Node<"vec3">)];
    const pxPerMetre = a1.xy.div(a1.w).sub(a0.xy.div(a0.w)).mul(screenSize).mul(0.5).length();
    /** Its core's half-width: scaled by charge and style, never under `minCorePx` across */
    const core = max(
      tint.w.mul(cfg.radius).mul(widen).mul(crackle).mul(thin),
      float(cfg.minCorePx / 2).div(pxPerMetre.max(1e-3)),
    );
    const across = positionLocal.x.mul(2).mul(core).mul(cfg.span);
    p = c.add(side.mul(jag.add(across)).mul(shown)) as THREE.Node<"vec3">;
  }
  const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1)));

  const rooms = attribute<"vec4">("beamRooms", "vec4");
  const seen = seenBy(view);
  const name = (key: string) => (tip ? `vBall${key}` : `vBeam${key}`);
  /** As their npcs are: the ball the target, the beam each end nearer it */
  const vSeen = varyingAs<"float">(
    tip ? seen(rooms.y, rooms.w) : mix(seen(rooms.x, rooms.z), seen(rooms.y, rooms.w), t.mul(locked)),
    name("Seen"),
  );
  const vShown = varyingAs<"float">(shown, name("Shown"));
  const vLocked = varyingAs<"float">(locked, name("Locked"));
  /** Its alpha's gain by the charge it was fired with */
  const vFired = varyingAs<"float">(fired.mul(cfg.chargeBright).add(1), name("Fired"));
  const along = varyingAs<"float">(t, name("T"));
  const vColor = varyingAs<"vec3">(tint.xyz, name("Color"));
  /** Metres short of the end, where the beam meets the body part */
  const toEnd = varyingAs<"float">(t.oneMinus().mul(len), name("ToEnd"));
  /** `-1` to `1` across the ribbon */
  const vAcross = varyingAs<"float">(positionLocal.x.mul(2), name("Across"));
  const vSeed = varyingAs<"float">(look.y, name("Seed"));
  /** Its style, one-hot: jagged, crackling, bolted */
  const vStyle = varyingAs<"vec3">(vec3(jagged, crackling, bolted), name("Style"));
  /** Lightning's brightness, flickering as it is redrawn: the same along the segment */
  const vFlash = varyingAs<"float">(
    hash(look.y.add(tickOf(cfg.jagHz).mul(31)))
      .mul(0.3)
      .add(0.7)
      .mul(cfg.solid) as F,
    name("Flash"),
  );

  const colorNode = Fn(() => {
    const flow = smoothstep(0.6, 1, fract(along.mul(cfg.bands).sub(phase)))
      .mul(0.5)
      .add(0.5); // pulses towards the target
    /** Faint and pulsing on the way, solid as it nears the part */
    const plain = mix(flow.mul(faint), float(cfg.solid), smoothstep(0, cfg.nearMetres, toEnd).oneMinus());
    const crackleA = plain.mul(
      hash(floor(toEnd.mul(12)).add(tickOf(cfg.staticHz).mul(37)).add(vSeed))
        .mul(0.9)
        .add(0.3),
    );
    const { period, speed, dash, boltBase } = cfg;
    const boltT = fract(toEnd.div(period).add(phase.mul(speed / period)));
    const boltA = mix(
      float(boltBase),
      float(cfg.solid),
      smoothstep(0, 0.05, boltT).mul(smoothstep(dash, dash - 0.1, boltT)),
    );
    const others = vStyle.x.add(vStyle.y).add(vStyle.z);
    const styled = plain
      .mul(others.oneMinus())
      .add(vFlash.mul(vStyle.x))
      .add(crackleA.mul(vStyle.y))
      .add(boltA.mul(vStyle.z));
    /** A solid core with a halo falling off to its edges */
    const off = abs(vAcross);
    const coreEdge = 1 / cfg.span;
    const profile = max(smoothstep(coreEdge * 1.3, coreEdge * 0.7, off), off.oneMinus().pow(2).mul(cfg.halo));
    const body = tip ? float(cfg.solid) : styled.mul(vLocked).mul(profile);
    const bright = body.mul(gain).mul(vFired).min(1);
    const a = view.objectPick.notEqual(0).select(0, vShown.mul(vSeen).mul(bright).mul(view.foldNode));
    Discard(a.lessThan(1 / 512));
    return vec4(vColor, a);
  })();

  return { vertexNode, colorNode };
}

export const beamShaderConfig = {
  /** Metres of half-width of the beam's core, and radius of the ball at its end */
  radius: 0.01,
  tipRadius: 0.035,
  /** The ribbon is `span` times its core's width, the rest a halo at most `halo` alpha */
  span: 3,
  halo: 0.35,
  /** Pixels across its core at least, however far */
  minCorePx: 2,
  /** A full charge widens the beam and ball by `1 + chargeWiden`, and its alpha by `1 + chargeBright` */
  chargeWiden: 1.5,
  chargeBright: 0.6,
  /** The beam's alpha within `nearMetres` of the body part */
  solid: 0.9,
  nearMetres: 0.25,
  /** Pulses along the beam, drifting towards the target a band per second */
  bands: 4,
  /** Lightning: redrawn `jagHz` times a second, kinked at `jagKnots` along it, aside by `jagPerMetre` of its length up to `jagMax` */
  jagHz: 16,
  jagKnots: 16,
  jagPerMetre: 0.06,
  jagMax: 0.2,
  jagWidth: 0.7,
  /** Static: its flicker's rate */
  staticHz: 30,
  /** Bolts: metres apart, metres a second, the share of each period lit, and the alpha between */
  period: 0.5,
  speed: 20,
  dash: 0.35,
  boltBase: 0.12,
  /** The ball's sides, and the ribbon's lengthways segments: a multiple of `jagKnots` */
  sides: 6,
  segments: 48,
} as const;
