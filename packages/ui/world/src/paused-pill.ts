import { type ComponentType, createContext, type PointerEvent, type WheelEvent } from "react";
import type { State as World } from "./components/World";

/** The paused pill's resume button. A tap resumes, and a pinch or wheel still reaches the camera */
export type ResumeProps = {
  ref(el: null | HTMLButtonElement): void;
  onClick(): void;
  onPointerDown(e: PointerEvent): void;
  onWheel(e: WheelEvent): void;
};

export type PausedPillProps = { w: World; paused: boolean; resumeProps: ResumeProps };

/** A paused pill forwarded by the app, shown in place of the World's own */
export const WorldPausedPillContext = createContext<null | ComponentType<PausedPillProps>>(null);
