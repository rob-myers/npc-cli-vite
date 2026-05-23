import * as THREE from "three";

export function crossFadeSynchronized(
  oldAction: THREE.AnimationAction,
  newAction: THREE.AnimationAction,
  duration = 0.5,
) {
  newAction.reset();

  // Sync the timeline position before the fade begins
  newAction.time = oldAction.time;
  newAction.timeScale = oldAction.timeScale;

  newAction.enabled = true;
  newAction.setEffectiveWeight(1);
  newAction.play();

  // Smoothly blend from old to new while locked in position
  oldAction.crossFadeTo(newAction, duration, true);
}

export const emptyAnimationClip = new THREE.AnimationClip();

emptyAnimationClip.name = "empty-animation-clip";
