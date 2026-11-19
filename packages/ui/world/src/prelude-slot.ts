import { type ComponentType, createContext } from "react";

/** What runs before a World first plays, forwarded by the app */
export type WorldPreludeSlot = {
  /** Shown in the paused pill until the first play */
  Ui: ComponentType<{ worldKey: string; container: null | HTMLElement; booting: boolean }>;
  /** Awaited on the first unpause, for at most `preludeMaxMs` */
  run(worldKey: string): Promise<void>;
};

export const WorldPreludeContext = createContext<null | WorldPreludeSlot>(null);
