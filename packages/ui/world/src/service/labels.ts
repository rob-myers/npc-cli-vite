import { attribute } from "three/tsl";
import * as THREE from "three/webgpu";
import { MAX_ROOM_LABEL_INSTANCES } from "../const.env";

/** A label's text, centred on its canvas — one layer of a label texture */
export function drawLabel(ct: CanvasRenderingContext2D, label: string) {
  const { width, height } = ct.canvas;
  ct.clearRect(0, 0, width, height);
  ct.textAlign = "center";
  ct.textBaseline = "alphabetic";
  ct.letterSpacing = "0.25em";
  let fontSize = labelFontSize;
  ct.font = `300 ${fontSize}px sans-serif`;
  let m = ct.measureText(label);
  // the box the glyphs occupy, NOT the advance width: `letterSpacing` leaves a trailing
  // gap, and measuring on that sits the words left of centre
  const boxWidth = () => m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  if (boxWidth() > width - labelPadding * 2) {
    fontSize *= (width - labelPadding * 2) / boxWidth(); // shrink to fit, not clip
    ct.font = `300 ${fontSize}px sans-serif`;
    m = ct.measureText(label);
  }

  // centred on the glyphs, both ways — `middle` centres the em box, which sits off the
  // optical centre of a word with no descenders
  ct.fillStyle = labelInk;
  ct.fillText(
    label,
    width / 2 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2,
    height / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2,
  );
}

/** Billboards built in the shader about a point each — see `RoomLabels` and `Labels` */
export function createLabelResources(maxInstances = MAX_ROOM_LABEL_INSTANCES) {
  const geo = new THREE.InstancedBufferGeometry();
  // every vertex sits at the instance's own point; `billboardOffset` spreads them in view space
  geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  // biome-ignore format: aligned to the canvas the label is drawn on
  geo.setAttribute("uv", new THREE.Float32BufferAttribute([
    0, 1,
    1, 1,
    1, 0,
    0, 0,
  ], 2));
  // biome-ignore format: the quad's corners, in halves of its width and height
  geo.setAttribute("billboardOffset", new THREE.Float32BufferAttribute([
    -1, -1,
     1, -1,
     1,  1,
    -1,  1,
  ], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);

  // per instance: world `xyz`, then which layer of the texture array says its name
  const instData = new Float32Array(maxInstances * 4);
  const instAttr = new THREE.InstancedBufferAttribute(instData, 4);
  geo.setAttribute("labelInstance", instAttr);
  // and the slot of the room it names, so it fades with it
  const slotData = new Float32Array(maxInstances);
  const slotAttr = new THREE.InstancedBufferAttribute(slotData, 1);
  geo.setAttribute("labelSlot", slotAttr);
  geo.instanceCount = 0;

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false, // over the world: an obstacle must not swallow the name of a room
    // built in view space, the quad always faces us — and a transparent DoubleSide draws twice
    side: THREE.FrontSide,
    opacity: 1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; // the quads are built in the shader, so their bounds mean nothing
  mesh.renderOrder = 5;

  return {
    geo,
    mat,
    mesh,
    instData,
    instAttr,
    slotData,
    slotAttr,
    inst: attribute<"vec4">("labelInstance", "vec4"),
    slot: attribute<"float">("labelSlot", "float"),
    sign: attribute<"vec2">("billboardOffset", "vec2"),
  };
}

const labelInk = "rgba(226, 236, 248, 0.92)";
const labelFontSize = 28;
/** Kept clear either side, in texture pixels — a longer name shrinks rather than reaching it */
const labelPadding = 24;
