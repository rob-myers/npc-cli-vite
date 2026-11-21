import * as THREE from "three/webgpu";

/** `clip` mirrored left to right, named `name`: its left and right bones' tracks swap. The rig rests unrotated */
export function mirrorClip(clip: THREE.AnimationClip, name: string) {
  const tracks = clip.tracks.map((track) => {
    const [bone, prop] = track.name.split(".");
    const out = track.clone();
    out.name = `${bone.replace(/^(left|right)/, (side) => (side === "left" ? "right" : "left"))}.${prop}`;
    const { values } = out;
    const size = out.getValueSize();
    for (let i = 0; i < values.length; i += size)
      if (prop === "quaternion") [values[i + 1], values[i + 2]] = [-values[i + 1], -values[i + 2]];
      else if (prop === "position") values[i] = -values[i];
    return out;
  });
  return new THREE.AnimationClip(name, clip.duration, tracks);
}
