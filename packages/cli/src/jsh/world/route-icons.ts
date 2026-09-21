import {
  ArmchairIcon,
  BellRingingIcon,
  ChatCircleTextIcon,
  DoorOpenIcon,
  EyeIcon,
  FootprintsIcon,
  HandshakeIcon,
  HourglassIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { RouteStep } from "./route";

/** One icon per kind of step — shared by the World's node cards and the NavRoutes panel */
export const routeStepIcon: Record<RouteStep["kind"], Icon> = {
  move: FootprintsIcon,
  do: ArmchairIcon,
  wait: HourglassIcon,
  look: EyeIcon,
  open: DoorOpenIcon,
  close: DoorOpenIcon,
  say: ChatCircleTextIcon,
  sync: HandshakeIcon,
  signal: BellRingingIcon,
  await: BellRingingIcon,
};
