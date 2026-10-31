import {
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  float,
  mix,
  modelWorldMatrix,
  mrt,
  normalGeometry,
  normalWorld,
  output,
  positionLocal,
  positionWorld,
  screenCoordinate,
  select,
  sin,
  smoothstep,
  step,
  texture as tslTexture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { State as WorldState } from "../components/World";
import { skinSliceDims } from "../const.both";
import { eyesConfig, ghostConfig, npcMaterialConfig } from "../const.npc";
import { OBJECT_PICK_KEY_TO_RED } from "./pick";
import { alwaysShownSlot } from "./room-slots";
import { selectAs } from "./tsl";

/** An npc's uniforms: their values are written, so the material is never rebuilt */
export type NpcUniforms = {
  colorScale: THREE.UniformNode<"float", number>;
  dotScreen: THREE.UniformNode<"float", number>;
  eyesUniform: THREE.UniformNode<"float", number>;
  labelRectUniform: THREE.UniformNode<"vec4", THREE.Vector4>;
  labelYShiftUniform: THREE.UniformNode<"float", number>;
  npcLit: THREE.UniformNode<"float", number>;
  pickIdUniform: THREE.UniformNode<"float", number>;
  /** `1` in the player's room, eased — see `NpcAnimation.tickRoomLit` */
  roomLit: THREE.UniformNode<"float", number>;
  roomSlot: THREE.UniformNode<"float", number>;
  skinIndexUniform: THREE.UniformNode<"float", number>;
};

export type NpcMaterial = NpcUniforms & {
  material: THREE.MeshStandardNodeMaterial;
  maskMrt: THREE.MRTNode;
};

type World = import("@npc-cli/util").UseStateRef<WorldState>;

/** Uniforms every npc's material reads, so a theme or slider change is a value write */
type NpcShared = { ambient: THREE.Node<"float">; dim: THREE.Node<"float">; sameRoom: THREE.Node<"float"> };

/**
 * An npc's material and its uniforms: their body, and their label in the same draw.
 * `shared` is every npc's — see `NPCs`' `ambientNode`, `dimNode` and `sameRoomNode`
 */
export function createNpcMaterial(w: World, pickId: number, skinIndex: number, shared: NpcShared): NpcMaterial {
  const u = createUniforms(pickId, skinIndex);

  // - has value 1 iff lit and lighting shown
  // - lit npcs will not be faded with their rooms
  const litAmount = u.npcLit.mul(w.view.litNpcsEnabled);
  const roomFade = w.view.fadeRoomsFx.getVisiblity(u.roomSlot);
  // every mode drains the colour over the room's fade, leaving a black figure we can still
  // watch move about — a lit npc keeps theirs
  const bodyTint = roomFade.max(litAmount);
  // An npc keeps its height whilst a map changes over, darkening and fading out together
  // as the world folds around it — see `setWorldFold`
  const fold = w.view.foldNode;

  // Per-vertex groupId: 0=body, 1=label
  const groupIdAttr = attribute<"float">("groupId", "float");
  const isLabel = groupIdAttr.greaterThan(0.5);
  const isMain = groupIdAttr.lessThan(0.5);
  const isPickMode = w.view.objectPick.notEqual(0);

  const { skinTex, skinRgb } = skinColor(w, u);
  // ADDED rather than multiplied, so it lights the body rather than tinting whatever the
  // skin happened to be — a dark uniform takes a rim as readily as a pale one
  const litRgb = skinRgb
    .mul(exposure(w, litAmount, u.roomLit, shared, fold))
    .add(vec3(...npcMaterialConfig.rim.color).mul(rim(fold)));
  // `alphaTestNode` below gives way with this, or the body would be discarded whole the
  // moment its alpha started dropping
  const mainColor = vec4(
    mix(vec3(0).mul(positionLocal.y), mix(litRgb, dotScreen(litRgb), u.dotScreen), u.colorScale),
    skinTex.a.mul(fold),
  );

  // a label is a caption rather than a part of them: it fades over the WHOLE of its room's
  // fade, well before and after the body's own share of it, and eased at both ends
  const labelFade = smoothstep(float(0), float(1), roomFade).max(litAmount);
  const label = w.view.fadeRoomsFx.applyFadeRgba(
    w.view.fadeRoomsFx.applyFadeAlpha(labelColor(w, u, isPickMode, fold), labelFade),
    labelFade,
  );

  // Output node: the pick's `g` is the joint drawn — see `npcJointToPickGreen`
  const bodyPart = attribute<"float">("bodyPart", "float").round(); // interpolated, if all alike
  const npcPickId = bodyPart.mul(256).add(u.pickIdUniform);
  const npcPick = w.view.withPickOutputId(OBJECT_PICK_KEY_TO_RED.npc, npcPickId, 1); // opaque, else blended

  const material = new THREE.MeshStandardNodeMaterial({
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide, // one draw call
    // - keep these fixed or they'll effect label quad
    // - could add metalness map but we'll handle via SVG edit instead
    metalness: 0,
    roughness: 1,
  });
  // - label/body fade in during unfold
  // - label fades in/out with room, whereas the body is cut away rather than faded
  material.alphaTestNode = selectAs(isLabel, float(0.1).mul(fold).mul(roomFade), float(0.9).mul(fold));
  material.vertexNode = vertexPosition(u, isLabel);
  material.colorNode = w.view.fadeRoomsFx.dropPickWhenHidden(
    (select as any)(isLabel, label, mainColor), // `bodyTint` is applied at the output, below
    roomFade,
    w.view.objectPick,
  );
  // blacked out at the OUTPUT: `colorNode` is only the albedo, and a standard material still
  // adds specular off the scene lights to an albedo of zero
  const beauty = selectAs(isMain, vec4(w.view.fadeRoomsFx.fadeRgb(output.rgb, bodyTint), output.a), output);
  material.outputNode = selectAs(isPickMode, npcPick, beauty);

  // The silhouette the border is grown from — see `service/npc-outline`. The BODY only: the
  // label is a billboard, and a border around it would read as a box floating overhead.
  // PREMULTIPLIED, against an alpha of `1` — which under the blend is a replace, and the npc
  // must replace rather than accumulate: an arm passing over the torso writes the mask twice,
  // and blending would sum it. `bodyTint` takes the border with it as they black out, and it
  // reaches `0` before the wipe does, so nothing outlines a figure that is no longer there
  const maskAmount = u.colorScale.mul(fold).mul(bodyTint);
  // The label writes no silhouette — it is not part of the figure — but marks itself in `g`
  // as a caption the border may not paint over: it sits a few pixels above the head, well
  // inside the border's reach. Keyed to the label's OWN alpha, so a faded one protects
  // nothing; that alpha also scales `r` back under it, which only ever costs mask the
  // caption is covering anyway
  const maskMrt = mrt({
    npcMask: selectAs(isMain, vec4(maskAmount, 0, 0, 1), vec4(0, 1, 0, label.a)),
  });
  // attached only whilst the scene pass declares the extra output — see `syncOutlineMask`
  material.mrtNode = w.view.npcMaskMrt === null ? null : maskMrt;

  return { ...u, material, maskMrt };
}

function createUniforms(pickId: number, skinIndex: number): NpcUniforms {
  return {
    colorScale: uniform(1),
    dotScreen: uniform(0),
    eyesUniform: uniform(0),
    // the text's own box in the label's uv, set by `drawLabel`
    labelRectUniform: uniform(new THREE.Vector4(0, 0, 1, 1)),
    labelYShiftUniform: uniform(0, "float"),
    npcLit: uniform(0),
    // ONE uniform for both uses, so renumbering is a value write rather than a rebuilt material
    pickIdUniform: uniform(pickId),
    roomLit: uniform(0),
    roomSlot: uniform(alwaysShownSlot, "float"),
    skinIndexUniform: uniform(skinIndex),
  };
}

/** Billboard expansion for the label, standard skinned MVP otherwise */
function vertexPosition(u: NpcUniforms, isLabel: THREE.Node<"bool">) {
  const { labelHalfWidth, labelHalfHeight } = npcMaterialConfig;
  const sign = attribute<"vec2">("billboardOffset", "vec2");
  const anchor = vec4(positionLocal.x, positionLocal.y.add(u.labelYShiftUniform), positionLocal.z, 1);
  const viewCtr = cameraViewMatrix.mul(modelWorldMatrix.mul(anchor));
  const labelPos = cameraProjectionMatrix.mul(
    viewCtr.add(vec4(sign.x.mul(labelHalfWidth), sign.y.mul(labelHalfHeight), 0, 0)),
  );
  const stdPos = cameraProjectionMatrix.mul(cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(positionLocal, 1))));
  return selectAs(isLabel, labelPos, stdPos);
}

/** Their skin, and their eyes: one slice of their skin's, over the face — see `docs/skin-slices.md` */
function skinColor(w: World, u: NpcUniforms) {
  const skinTex = tslTexture(w.texSkin.tex, uv()).depth(u.skinIndexUniform);
  const { face } = eyesConfig;
  const faceUv = uv().sub(vec2(face.x, face.y)).div(face.size);
  const inFace = step(0, faceUv.x)
    .mul(step(faceUv.x, float(1)))
    .mul(step(0, faceUv.y))
    .mul(step(faceUv.y, float(1)));
  const slicesPerRow = skinSliceDims.cell / skinSliceDims.slice;
  const eyes = tslTexture(
    w.texSkinSlices.tex,
    vec2(u.eyesUniform.mod(slicesPerRow), u.eyesUniform.div(slicesPerRow).floor())
      .add(faceUv.clamp(0, 0.999))
      .div(slicesPerRow),
  ).depth(u.skinIndexUniform);
  return { skinTex, skinRgb: mix(skinTex.rgb, eyes.rgb, eyes.a.mul(inFace)) };
}

/** Ambient, plus the player's light, plus more whilst lit or in the player's room: the light takes what the ambient leaves */
function exposure(
  w: World,
  litAmount: THREE.Node<"float">,
  roomLit: THREE.Node<"float">,
  { ambient, dim, sameRoom }: NpcShared,
  fold: THREE.Node<"float">,
) {
  const { ambient: least, ambientInSight, litAmbient, faceShade, faceShadeDir } = npcMaterialConfig;
  const toLight = new THREE.Vector3(...faceShadeDir).normalize();
  const ambientNow = mix(float(least), float(ambientInSight), w.view.fadeRoomsFx.sightNode).max(ambient);
  return (
    ambientNow
      .add(w.view.playerLight.litBody(normalWorld).mul(ambientNow.oneMinus()))
      .add(litAmount.mul(litAmbient))
      .add(roomLit.mul(sameRoom))
      .clamp(0, 1)
      // flat-shaded from `faceShadeDir`, half-Lambert: whatever the light, and steady as the camera turns
      .mul(normalWorld.dot(vec3(toLight)).mul(faceShade / 2).add(1 - faceShade / 2))
      .mul(fold)
      .mul(dim)
  );
}

/**
 * Rim shading where the body turns away from the view: `1 - N·V` is largest exactly along the silhouette.
 * Eased off as the camera climbs overhead, where nearly every surface is a flank turned edge-on
 */
function rim(fold: THREE.Node<"float">) {
  const { rim: config } = npcMaterialConfig;
  const toEye = cameraPosition.sub(positionWorld).normalize();
  const facing = normalWorld.dot(toEye).clamp(0, 1);
  // `toEye.y` is how much of the view is straight down
  const overhead = smoothstep(float(config.overheadFrom), float(config.overheadTo), toEye.y);
  const bright = mix(float(config.amount), float(config.overheadAmount), overhead);
  /** `0` on a cuboid's end caps, which a bent joint bares edge-on */
  const notCap = normalGeometry.y.abs().oneMinus();
  return facing.oneMinus().pow(config.power).mul(bright).mul(notCap).mul(fold);
}

/** `rgb` as a dot screen, its dots fixed on the screen, white where it is bright — see `NpcGhost` */
function dotScreen(rgb: THREE.Node<"vec3">) {
  const { angle, scale, gain } = ghostConfig.dots;
  const [cos, sinA] = [Math.cos(angle) * scale, Math.sin(angle) * scale];
  const px = screenCoordinate.xy;
  const dots = sin(px.x.mul(cos).sub(px.y.mul(sinA))).mul(sin(px.x.mul(sinA).add(px.y.mul(cos))));
  const grey = rgb.x.add(rgb.y).add(rgb.z).div(3);
  return vec3(smoothstep(0.45, 0.55, grey.mul(gain).add(dots.mul(0.5))));
}

/** Their label's text: picked as a solid box round it, else only its ink would be. It fades WITH the body */
function labelColor(w: World, u: NpcUniforms, isPickMode: THREE.Node<"bool">, fold: THREE.Node<"float">) {
  const rect = u.labelRectUniform;
  const labelTex = tslTexture(w.texNpcLabel.tex, uv()).depth(u.pickIdUniform);
  const inRect = step(rect.x, uv().x).mul(step(rect.y, uv().y)).mul(step(uv().x, rect.z)).mul(step(uv().y, rect.w));
  const alpha = selectAs<"float">(isPickMode, inRect, labelTex.a);
  return vec4(labelTex.rgb, alpha.mul(u.colorScale).mul(fold));
}
