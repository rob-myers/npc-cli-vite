import { Menu } from "@base-ui/react/menu";
import { themeApi, useThemeName } from "@npc-cli/theme";
import { cn, tw } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import {
  ArrowCounterClockwiseIcon,
  ChartLineIcon,
  InfoIcon,
  MoonIcon,
  RobotIcon,
  SquareHalfBottomIcon,
  SquareHalfIcon,
  StackSimpleIcon,
  SunIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { hasWebMcp } from "../web-mcp";
import { flattenPanes, splitTabs } from "./pane-service";

/** `GlobalMenu`'s items. Lazy, so their icons stay out of the page's entry */
export default function GlobalMenuItems(props: GlobalMenuItemsProps) {
  const theme = useThemeName();

  return (
    <>
      <Menu.Item className={itemClass} closeOnClick={false} onClick={() => themeApi.setOther()}>
        {theme === "dark" ? <SunIcon className={iconClass} /> : <MoonIcon className={iconClass} />}
        {theme === "dark" ? "Light theme" : "Dark theme"}
      </Menu.Item>

      <Menu.Separator className={separatorClass} />

      {/* a phone has no room for panes side by side */}
      <div
        className={cn(
          itemClass,
          touchDevice && "hidden",
          !props.canSplit && "text-slate-500",
          "cursor-default hover:bg-transparent",
        )}
        title={props.canSplit ? "move half of a pane's tabs beside it" : "no pane has two tabs"}
      >
        Split
        <span className="ml-auto flex gap-1">
          <Menu.Item
            className="p-1 rounded hover:bg-slate-700 cursor-pointer data-disabled:pointer-events-none"
            aria-label="Split side by side"
            title="Split side by side"
            disabled={!props.canSplit}
            onClick={() => splitTabs(false)}
          >
            <SquareHalfIcon className={iconClass} />
          </Menu.Item>
          <Menu.Item
            className="p-1 rounded hover:bg-slate-700 cursor-pointer data-disabled:pointer-events-none"
            aria-label="Split top and bottom"
            title="Split top and bottom"
            disabled={!props.canSplit}
            onClick={() => splitTabs(true)}
          >
            <SquareHalfBottomIcon className={iconClass} />
          </Menu.Item>
        </span>
      </div>

      {props.paneCount > 1 && (
        <Menu.Item className={itemClass} onClick={flattenPanes}>
          <StackSimpleIcon className={iconClass} />
          Flatten layout
        </Menu.Item>
      )}

      <Menu.Item
        className={cn(itemClass, props.resetArmed && "text-red-300")}
        closeOnClick={false}
        onClick={props.onReset}
      >
        {props.resetArmed ? <WarningIcon className={iconClass} /> : <ArrowCounterClockwiseIcon className={iconClass} />}
        {/* both labels share a cell, so the item is as wide as the wider whichever shows */}
        <span className="grid *:col-start-1 *:row-start-1">
          <span className={cn(props.resetArmed && "invisible")}>Reset layout</span>
          <span className={cn(!props.resetArmed && "invisible")}>Confirm reset</span>
        </span>
      </Menu.Item>

      <Menu.Separator className={separatorClass} />

      <Menu.Item className={itemClass} onClick={props.onAbout}>
        <InfoIcon className={iconClass} />
        About
      </Menu.Item>

      <Menu.Item
        className={cn(itemClass, !props.webMcpOn && "text-slate-500")}
        closeOnClick={false}
        disabled={!hasWebMcp()}
        title={hasWebMcp() ? "offer the ttys to a browser agent" : "this browser has no WebMCP"}
        onClick={props.onToggleWebMcp}
      >
        <RobotIcon className={iconClass} />
        {props.webMcpOn ? "WebMCP: on" : "WebMCP: off"}
      </Menu.Item>

      {import.meta.env.DEV && (
        <Menu.Item
          className={cn(itemClass, props.trackingOff && "text-slate-500")}
          closeOnClick={false}
          onClick={props.onToggleTracking}
        >
          <ChartLineIcon className={iconClass} />
          {props.trackingOff ? "Tracking: off" : "Tracking: on"}
        </Menu.Item>
      )}
    </>
  );
}

export interface GlobalMenuItemsProps {
  /** Some shown pane has two tabs to split between */
  canSplit: boolean;
  paneCount: number;
  /** Reset was pressed once, so the next press confirms it */
  resetArmed: boolean;
  trackingOff: boolean;
  webMcpOn: boolean;
  onAbout(): void;
  onReset(): void;
  onToggleTracking(): void;
  onToggleWebMcp(): void;
}

const touchDevice = isTouchDevice();

const itemClass = cn(
  "flex items-center gap-2 px-3 text-slate-300 hover:bg-slate-700 cursor-pointer",
  touchDevice ? "py-2.5 text-sm" : "py-1.5 text-xs",
);
const iconClass = tw("size-4 shrink-0");
const separatorClass = tw("my-1 border-t border-slate-700");
