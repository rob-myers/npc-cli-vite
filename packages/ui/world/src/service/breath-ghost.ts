import {
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  float,
  mix,
  modelWorldMatrix,
  normalLocal,
  normalWorld,
  positionLocal,
  positionWorld,
  smoothstep,
  uniform,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { MAX_NPCS } from "../const.env";
import { breathConfig } from "../const.npc";
import { selectAs } from "./tsl";

/**
 * What breathes inside every npc breathing, seen through them: lungs and a diaphragm, in ONE
 * instanced mesh — see `docs/npc-breath.md`. An instance is carried by its npc's chest bone
 */
export function createBreathGhost(objectPick: THREE.Node<"float">) {
  const { lung, diaphragm, depthBias, above } = breathConfig;
  /** Per instance: the air in their lungs, the effort of breathing in, how bright, and metres of swell */
  const nowData = new Float32Array(MAX_NPCS * 4);
  const nowAttr = new THREE.InstancedBufferAttribute(nowData, 4);
  /** Per instance: the way their chest stands, in the world */
  const upData = new Float32Array(MAX_NPCS * 3);
  const upAttr = new THREE.InstancedBufferAttribute(upData, 3);
  const now = attribute<"vec4">("breathNow", "vec4");
  const [full, drive, glow, reach] = [now.x, now.y, now.z, now.w];

  const organ = attribute<"float">("organ", "float");
  const isLung = organ.lessThan(0.5);

  // each vertex moves along its `normal`, which for the diaphragm is straight down
  const off = normalLocal.normalize().mul(reach.mul(full).mul(attribute<"float">("breathShare", "float")));
  const view = cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(positionLocal.add(off), 1)));
  const clip = cameraProjectionMatrix.mul(view);
  const nearer = cameraProjectionMatrix.mul(view.add(vec4(0, 0, depthBias, 0)));

  const toEye = cameraPosition.sub(positionWorld).normalize();
  const rim = normalWorld.normalize().dot(toEye).abs().oneMinus().pow(lung.rimPower);
  // in the shader, so it follows a camera turned whilst the world is paused
  const along = attribute<"vec3">("breathUp", "vec3").dot(toEye).abs();
  const fromAbove = mix(float(1), float(above.left), smoothstep(float(above.fade[0]), float(above.fade[1]), along));
  const lungShown = mix(float(lung.faceOn), float(1), rim)
    .mul(mix(float(lung.empty), float(1), full))
    .mul(fromAbove);
  const diaphragmShown = mix(float(diaphragm.rest), float(1), drive);
  const shown = selectAs<"float">(isLung, lungShown, diaphragmShown);

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  material.vertexNode = vec4(clip.xy, nearer.z.div(nearer.w).mul(clip.w), clip.w);
  material.colorNode = selectAs<"vec3">(
    isLung,
    uniform(new THREE.Color(lung.color)),
    uniform(new THREE.Color(diaphragm.color)),
  );
  // nothing of it in a pick: additive, so an alpha of nought adds nothing
  material.opacityNode = glow.mul(shown).mul(objectPick.equal(0).toFloat());

  const geometry = createAnatomy();
  geometry.setAttribute("breathNow", nowAttr);
  geometry.setAttribute("breathUp", upAttr);
  const mesh = new THREE.InstancedMesh(geometry, material, MAX_NPCS);
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.raycast = () => {};

  return { mesh, nowData, nowAttr, upData, upAttr };
}

/** `organ` of each vertex */
const LUNG = 0;
const DIAPHRAGM = 1;

/**
 * Lungs and a diaphragm, in the chest bone's own frame.
 * `normal` is the way a vertex moves with a breath, and `breathShare` how far
 */
function createAnatomy() {
  const out = { position: [] as number[], normal: [] as number[], index: [] as number[] };
  const attrs = { organ: [] as number[], breathShare: [] as number[] };
  const push = (at: number[], way: number[], organ: number, share: number) => {
    out.position.push(...at);
    out.normal.push(...way);
    attrs.organ.push(organ);
    attrs.breathShare.push(share);
  };
  /** A grid of `rows + 1` by `cols + 1` vertices from `first`, as triangles */
  const grid = (first: number, rows: number, cols: number) => {
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const a = first + i * (cols + 1) + j;
        const b = a + cols + 1;
        out.index.push(a, b, a + 1, a + 1, b, b + 1);
      }
  };

  const { lung, diaphragm } = breathConfig;
  const [stacks, slices] = [6, 10];
  for (const side of [1, -1]) {
    const first = out.position.length / 3;
    for (let i = 0; i <= stacks; i++)
      for (let j = 0; j <= slices; j++) {
        const [u, v] = [(i / stacks) * Math.PI, (j / slices) * Math.PI * 2];
        const unit = [Math.sin(u) * Math.cos(v), Math.cos(u), Math.sin(u) * Math.sin(v)];
        const at = unit.map((n, k) => lung.centre[k] * (k === 0 ? side : 1) + n * lung.radii[k]);
        push(
          at,
          unit.map((n, k) => n / lung.radii[k]),
          LUNG,
          1,
        );
      }
    grid(first, stacks, slices);
  }

  // a dome under the lungs, whose crown drops as it contracts: its rim does not move
  const [rings, spokes] = [4, 12];
  const firstRing = out.position.length / 3;
  for (let i = 0; i <= rings; i++)
    for (let j = 0; j <= spokes; j++) {
      const [r, angle] = [i / rings, (j / spokes) * Math.PI * 2];
      const crown = 1 - r * r;
      const [x, z] = [diaphragm.radii[0] * r * Math.cos(angle), diaphragm.radii[1] * r * Math.sin(angle)];
      push([x, diaphragm.y + diaphragm.dome * crown, z], [0, -1, 0], DIAPHRAGM, crown * diaphragm.travel);
    }
  grid(firstRing, rings, spokes);

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(out.index);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(out.position, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(out.normal, 3));
  for (const [name, values] of Object.entries(attrs))
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, 1));
  return geometry;
}
