import type { UseStateRef } from "@npc-cli/util";
import { createContext } from "react";
import type { Layout } from "react-grid-layout";
import type { SkipNetContent, SkipNetUiMeta, SkipNetWindow } from "./schema";

export type State = {
  /** The alert asking to clear the desktop is open */
  clearAsked: boolean;
  /** What jsh mounted on our World, read once for every window */
  items: JshCli.SkipNetItem[];
  meta: SkipNetUiMeta;
  /** The panel is narrower than `stackPx`, so its windows are stacked */
  narrow: boolean;
  /** The front window as the last press began, so a click on another's bar only fronts it */
  pressedFrontId: undefined | string;
  rootEl: null | HTMLDivElement;
  /** Stacks it over every other */
  bringToFront(id: string): void;
  /** Compacts the windows upwards, once */
  cleanUp(): void;
  /** Closes every window */
  clear(): void;
  close(id: string): void;
  /** Swaps it with its neighbour in the stack, above on `-1`, below on `1` */
  moveInStack(id: string, by: -1 | 1): void;
  /** A new window, else fronts the one already showing that folder, article or item */
  open(content: SkipNetContent): void;
  /** Keeps where each window was dragged or resized to */
  saveLayout(layout: Layout): void;
  setArrange(arrange: SkipNetUiMeta["arrange"]): void;
  setClearAsked(clearAsked: boolean): void;
  /** Each stacked window's share of the height, by id, unfolding `unfoldId` if given */
  setStackFlex(flexById: Record<string, number>, unfoldId?: string): void;
  setWindow(id: string, patch: Partial<SkipNetWindow>): void;
  setWindows(windows: SkipNetWindow[]): void;
  /** Rolls it up to its title bar, or back down */
  toggleShade(id: string): void;
};

export const SkipNetContext = createContext<UseStateRef<State>>(null as never);

/** A place in its window's title bar, e.g. for its session picker */
export const TitleSlotContext = createContext<null | HTMLElement>(null);
