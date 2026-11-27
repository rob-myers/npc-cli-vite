import { useContext, useEffect, useMemo } from "react";
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cos,
  float,
  instanceIndex,
  mix,
  positionLocal,
  sin,
  smoothstep,
  time,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { npcDims } from "../const.both";
import { MAX_NPCS } from "../const.env";
import { emberConfig, npcFxKinds } from "../const.npc";
import { WorldContext } from "./world-context";

/** Embers rising off each npc with the `embers` effect: camera-facing specks, in one draw, moved by the shader */
export default function NpcEmbers() {
  const w = useContext(WorldContext);
  const embers = useMemo(createEmbers, []);

  useMemo(() => {
    // fades with its npc's room, as their shadow does
    const fade = w.view.fadeRoomsFx.getVisiblity(embers.slot);
    const { vertexNode, colorNode } = emberNodes(embers, fade.mul(w.view.foldNode));
    embers.mat.vertexNode = vertexNode;
    embers.mat.colorNode = colorNode;
    embers.mat.needsUpdate = true;
  }, [w.view.fadeRoomsFx.uid]);

  useEffect(
    () =>
      w.e.addFrameCallback(() => {
        const { data, slots, posAttr, slotAttr, geo, mesh } = embers;
        const { count } = emberConfig;
        let i = 0;
        for (const key in w.n) {
          const npc = w.n[key];
          if (npc.fxKind?.value !== emberKind || i + count > slots.length) continue;
          const { x, y, z } = npc.position;
          // `count` in a row, one per ember: the shader tells them apart by index
          for (let k = 0; k < count; k++, i++) {
            data[i * 4] = x;
            data[i * 4 + 1] = y;
            data[i * 4 + 2] = z;
            data[i * 4 + 3] = npc.heightScale;
            slots[i] = npc.roomSlot.value;
          }
        }
        geo.instanceCount = i;
        mesh.visible = i > 0;
        if (i === 0) return;
        upload(posAttr, i * 4);
        upload(slotAttr, i);
      }),
    [],
  );

  useEffect(() => () => void embers.geo.dispose(), []);

  return <primitive object={embers.mesh} />;
}

function createEmbers() {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setIndex(base.getIndex());
  const max = MAX_NPCS * emberConfig.count;
  /** Per ember: its npc's feet, and their height scale */
  const data = new Float32Array(max * 4);
  const posAttr = new THREE.InstancedBufferAttribute(data, 4);
  geo.setAttribute("emberPos", posAttr);
  /** Per ember: its npc's room slot */
  const slots = new Float32Array(max);
  const slotAttr = new THREE.InstancedBufferAttribute(slots, 1);
  geo.setAttribute("emberSlot", slotAttr);
  geo.instanceCount = 0;

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  // after the npcs and walls: drawn first, they would paint over it, as it writes no depth
  mesh.renderOrder = 5;
  const pos = attribute<"vec4">("emberPos", "vec4");
  const slot = attribute<"float">("emberSlot", "float");
  return { geo, mat, mesh, data, posAttr, slots, slotAttr, pos, slot };
}

/** Each ember starts on the body at random, rises drifting, and fades as it cools, then starts again */
function emberNodes(embers: ReturnType<typeof createEmbers>, fade: THREE.Node<"float">) {
  const { size, life, rise, drift, spread, from, to, hot, cool, glow, fadeOut, towardCamera } = emberConfig;
  const { pos } = embers;
  const scale = pos.w;
  /** Random in `[0, 1)` from the ember's index */
  const hash = (k: number) =>
    sin(
      float(instanceIndex)
        .mul(12.9898)
        .add(k * 78.233),
    )
      .mul(43758.5453)
      .fract();
  const [seed, out, up] = [hash(1), hash(2), hash(3)];
  /** How far through its life, `0` to `1` */
  const age = time.div(life).add(seed).fract();
  const angle = seed.mul(2 * Math.PI);
  const start = vec3(
    cos(angle).mul(out).mul(spread),
    mix(float(from), float(to), up).mul(npcDims.height),
    sin(angle).mul(out).mul(spread),
  ).mul(scale);
  const sway = sin(age.mul(6).add(seed.mul(20))).mul(drift);
  const at = pos.xyz.add(start).add(vec3(sway, age.mul(rise), cos(age.mul(5).add(seed.mul(9))).mul(drift)));
  const corner = vec2(positionLocal.x, positionLocal.y).mul(size);
  const vertexNode = cameraProjectionMatrix.mul(
    cameraViewMatrix.mul(vec4(at, 1)).add(vec4(corner, scale.mul(towardCamera), 0)),
  );

  /** A soft round speck, fading in quickly and out slowly */
  const dot = smoothstep(0.5, 0.1, vec2(positionLocal.x, positionLocal.y).length());
  const alpha = dot.mul(smoothstep(0, 0.1, age)).mul(age.oneMinus().pow(fadeOut));
  const rgb = mix(vec3(...hot), vec3(...cool), age);
  return { vertexNode, colorNode: vec4(rgb.mul(alpha).mul(glow).mul(fade), 1) };
}

/** Only the first `length` values go to the gpu, not every slot up to `MAX_NPCS` */
function upload(attr: THREE.InstancedBufferAttribute, length: number) {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, length);
  attr.needsUpdate = true;
}

const emberKind = npcFxKinds.indexOf("embers");
