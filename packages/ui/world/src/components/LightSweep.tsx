import { useFrame } from "@react-three/fiber";
import { useContext, useEffect } from "react";
import type * as THREE from "three/webgpu";
import { WorldContext } from "./world-context";

/**
 * Runs the player light's sweep each frame, before the render — see `service/player-light` —
 * and reads the player's frontier off it — see `service/player-frontier`
 */
export default function LightSweep() {
  const w = useContext(WorldContext);

  useEffect(() => {
    // the walls never move, so they are read once per map — the doors are read per frame, being
    // few and the only occluders that change
    w.gms.length > 0 && w.gmsData !== undefined && w.view.playerLight.syncWalls(w.gms, w.gmsData);
  }, [w.gmsHash, w.gmsData]);

  useFrame((root, delta) => {
    const renderer = root.gl as unknown as THREE.WebGPURenderer;
    const player = w.n[w.player?.key ?? ""];
    w.view.playerLight.update(
      renderer,
      player?.position ?? null,
      player?.rotation.y ?? 0,
      w.d ?? emptyDoors,
      w.door?.openRatioArray ?? emptyOpenRatios,
      w.view.fadeRoomsFx.mode === "prod",
    );
    // and how far ahead they can see, off the sweep just dispatched — only whilst it is wanted
    if (player !== undefined && w.view.cameraMode === "canonical") {
      w.view.playerFrontier.update(player.rotation.y, delta);
    }
  }, -2);

  return null;
}

const emptyOpenRatios = new Float32Array(0);
const emptyDoors: Record<string, Geomorph.DoorState> = {};
