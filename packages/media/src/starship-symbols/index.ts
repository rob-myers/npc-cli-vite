import type { KeysOfUnion } from "@npc-cli/util/types";

export const symbolByGroup = {
  "geomorph-core": {
    "g-101--multipurpose": true,
    "g-102--research-deck": true,
    "g-103--cargo-bay-full": true,
  },

  "geomorph-edge": {
    "g-301--bridge": true,
    "g-302--xboat-repair-bay": true,
    "g-303--passenger-deck": true,
  },

  "symbol-bridge": {
    "bridge--042--8x9": true,
  },

  "symbol-furniture-consoles-equipment": {
    "bed--003--1x1.6": true,
    "bed--004--0.8x1.4": true,
    "bed--005--0.6x1.2": true,

    "console--005--1.2x4": true,
    "console--006--1.2x3": true,
    "console--010--1.2x2": true,
    "console--011--1.2x2": true,
    "console--018--1x1": true,
    "console--019--2x2": true,
    "console--022--1x2": true,
    "console--031--1x1.2": true,
    "console--033--0.4x0.6": true,
    "console--051--0.4x0.6": true,

    "couch-and-chairs--006--0.4x2": true,
    "couch-and-chairs--007--0.6x1.4": true,

    "counter--006--0.4x2": true,
    "counter--007--0.4x1": true,
    "counter--009--0.4x0.4": true,
    "counter--010--0.4x0.4": true,

    "medical-bed--005--0.6x1.2": true,
    "medical-bed--006--1.6x3.6": true,

    "table--004--1.2x2.4": true,
    "table--009--0.8x0.8": true,
    "table--012--0.8x0.8": true,
  },

  "symbol-lab": {
    "lab--012--3x4": true,
    "lab--018--4x4": true,
    "lab--023--4x4": true,
  },

  "symbol-machinery": {
    "machinery--155--1.8x3.6": true,
    "machinery--156--1.8x3.6": true,
    "machinery--158--1.8x3.6": true,
    "machinery--357--2.2x4": true,
  },

  "symbol-small-craft": {
    "lifeboat--small-craft": true,
  },

  "symbol-misc": {
    "iris-valves--005--1x1": true,
    "iris-valves--006--1x1": true,
    "misc-stellar-cartography--020--10x10": true,
    "misc-stellar-cartography--023--4x4": true,
    "window--001--0x1": true,
    "window--005--0x2": true,
    "window--007--0x2.4": true,
  },

  "symbol-office": {
    "office--001--2x2": true,
    "office--004--2x2": true,
    "office--006--2x2": true,
    "office--026--2x3": true,
    "office--020--2x3": true,
    "office--023--2x3": true,
    "office--061--3x4": true,
    "office--074--4x4": true,
    "office--089--4x4": true,
  },

  "symbol-galley-and-mess": {
    "galley-and-mess-halls--006--2x4": true,
  },

  "symbol-medical": {
    "medical--007--2x3": true,
    "medical--008--2x3": true,
  },

  "symbol-cargo": {
    "cargo--002--2x2": true,
    "cargo--010--2x4": true,
    "cargo--003--2x4": true,
  },

  "symbol-empty-room": {
    "empty-room--006--2x2": true,
    "empty-room--013--2x3": true,
    "empty-room--019--2x4": true,
    "empty-room--020--2x4": true,
    "empty-room--039--3x4": true,
    "empty-room--060--4x4": true,
  },

  "symbol-engineering": {
    "engineering--045--4x6": true,
    "engineering--047--4x7": true,
  },

  "symbol-fresher": {
    "fresher--002--1x1": true,
    "fresher--015--1x2": true,
    "fresher--020--2x2": true,
    "fresher--025--2x3": true,
    "fresher--036--2x4": true,
  },

  "symbol-fuel": {
    "fuel--010--2x4": true,
  },

  "symbol-lounge": {
    "lounge--015--2x4": true,
    "lounge--017--2x4": true,
  },

  "symbol-low-berth": {
    "low-berth--003--1x1": true,
  },

  "symbol-ships-locker": {
    "ships-locker--003--1x1": true,
    "ships-locker--007--1x2": true,
    "ships-locker--011--1x2": true,
    "ships-locker--020--2x2": true,
  },

  "symbol-shop-repair-area": {
    "shop--027--0.4x1.6": true,
    "shop--028--0.8x1.6": true,
    "shop--031--0.4x0.8": true,
    "shop--033--0.6x1.6": true,
    "shop--035--0.4x0.8": true,
    "shop--037--0.4x0.8": true,
  },

  "symbol-stateroom": {
    "stateroom--012--2x2": true,
    "stateroom--014--2x2": true,
    "stateroom--018--2x3": true,
    "stateroom--019--2x3": true,
    "stateroom--020--2x3": true,
    "stateroom--035--2x3": true,
    "stateroom--036--2x4": true,
  },
} as const;

/**
 * Symbols not directly based on some extracted spaceship symbol PNG.
 */
export const extraSymbols = {
  "extra--001--fresher--0.5x0.5": true,
  "extra--002--fresher--0.5x0.5": true,
  "extra--003--chair--0.25x0.25": true,
  "extra--004--desk--0.5x1": true,
  "extra--005--chair-0.25x0.25": true,
  "extra--006--desk--0.4x1": true,
  "extra--007--desk--0.4x0.66": true,
  "extra--008--desk--0.4x1.33": true,
  "extra--009--table--4x4": true,
  "extra--010--machine--2x1": true,
  "extra--011--machine--1x3": true,
  "extra--012--battery--3x2": true,
  "extra--013--privacy-screen--1.5x0.2": true,
  "extra--014--table--2x3": true,
  "extra--015--table--3x0.5": true,
  "extra--016--table--4x0.5": true,
  "extra--017--table--2x0.5": true,
  "extra--018--table-0.25x0.25": true,
  "extra--019--table-0.5x2": true,
  "extra--020--table-2x0.66": true,
  "extra--021--screen--0.1x0.5": true,
} as const;

export type StarshipSymbolGroup = keyof typeof symbolByGroup;

export type StarshipSymbolImageKey = KeysOfUnion<(typeof symbolByGroup)[StarshipSymbolGroup]>;
