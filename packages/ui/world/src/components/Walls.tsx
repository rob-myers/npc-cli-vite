import { useStateRef } from "@npc-cli/util";
import { useContext } from "react";
import type * as THREE from "three/webgpu";
import { createXyQuad } from "../service/geometry";
import { WorldContext } from "./world-context";

export default function Walls() {
  const w = useContext(WorldContext);
  const state = useStateRef(
    (): State => ({
      inst: null,
      quad: createXyQuad(),
    }),
  );
  return (
    <instancedMesh name="walls" ref={state} args={[state.quad, undefined, w.gmsData.wallCount]}>
      {/* 🚧 */}
      <meshStandardMaterial color="red" />
    </instancedMesh>
  );
}

type State = {
  inst: null | THREE.InstancedMesh;
  quad: THREE.BufferGeometry;
};
