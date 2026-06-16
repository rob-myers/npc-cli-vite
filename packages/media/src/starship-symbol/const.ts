import { hashJson, keys } from "@npc-cli/util/legacy/generic";

/**
 * Symbols not directly based on some extracted spaceship symbol PNG.
 */
const extraSymbols = {
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
  "extra--021--shower": true,
} as const;

export const symbolByGroup = {
  extra: {
    /**
     * - 🔔 only add once provided in packages/media/src/starship-symbol/output/extra
     * - afterwards run `pnpm starship-pngs-to-public`
     */
    "extra--001--fresher--0.5x0.5": true,
    "extra--002--fresher--0.5x0.5": true,
    "extra--003--chair--0.25x0.25": true,
    "extra--004--desk--0.5x1": true,
    "extra--005--chair-0.25x0.25": true,
    "extra--021--shower": true,
  } satisfies Partial<Record<keyof typeof extraSymbols, true>>,

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
    "bridge--042": true,
  },

  "symbol-furniture-consoles-equipment": {
    "bed--003": true,
    "bed--004": true,
    "bed--005": true,

    "console--005": true,
    "console--006": true,
    "console--010": true,
    "console--011": true,
    "console--018": true,
    "console--019": true,
    "console--022": true,
    "console--031": true,
    "console--033": true,
    "console--051": true,

    "couch-and-chairs--006": true,
    "couch-and-chairs--007": true,

    "counter--006": true,
    "counter--007": true,
    "counter--009": true,
    "counter--010": true,

    "medical-bed--005": true,
    "medical-bed--006": true,

    "table--004": true,
    "table--009": true,
    "table--012": true,
  },

  "symbol-lab": {
    "lab--012": true,
    "lab--018": true,
    "lab--023": true,
  },

  "symbol-machinery": {
    "machinery--155": true,
    "machinery--156": true,
    "machinery--158": true,
    "machinery--357": true,
  },

  "symbol-small-craft": {
    "lifeboat--small-craft": true,
  },

  "symbol-misc": {
    "iris-valves--005": true,
    "iris-valves--006": true,
    "misc-stellar-cartography--020--10x10": true,
    "misc-stellar-cartography--023--4x4": true,
    "window--001": true,
    "window--005": true,
    "window--007": true,
  },

  "symbol-office": {
    "office--001": true,
    "office--004": true,
    "office--006": true,
    "office--026": true,
    "office--020": true,
    "office--023": true,
    "office--061": true,
    "office--074": true,
    "office--089": true,
  },

  "symbol-galley-and-mess": {
    "galley-and-mess-halls--006--2x4": true,
  },

  "symbol-medical": {
    "medical--007": true,
    "medical--008": true,
  },

  "symbol-cargo": {
    "cargo--002": true,
    "cargo--010": true,
    "cargo--003": true,
  },

  "symbol-empty-room": {
    "empty-room--006": true,
    "empty-room--013": true,
    "empty-room--019": true,
    "empty-room--020": true,
    "empty-room--039": true,
    "empty-room--060": true,
  },

  "symbol-engineering": {
    "engineering--045": true,
    "engineering--047": true,
  },

  "symbol-fresher": {
    "fresher--002": true,
    "fresher--015": true,
    "fresher--020": true,
    "fresher--025": true,
    "fresher--036": true,
  },

  "symbol-fuel": {
    "fuel--010": true,
  },

  "symbol-lounge": {
    "lounge--015": true,
    "lounge--017": true,
  },

  "symbol-low-berth": {
    "low-berth--003": true,
  },

  "symbol-ships-locker": {
    "ships-locker--003": true,
    "ships-locker--007": true,
    "ships-locker--011": true,
    "ships-locker--020": true,
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
    "stateroom--012": true,
    "stateroom--014": true,
    "stateroom--018": true,
    "stateroom--019": true,
    "stateroom--020": true,
    "stateroom--035": true,
    "stateroom--036": true,
  },
} as const;

export const symbolByGroupHash = hashJson(symbolByGroup);

export type StarshipSymbolGroup = keyof typeof symbolByGroup;

export const geomorphKeys = [...keys(symbolByGroup["geomorph-core"]), ...keys(symbolByGroup["geomorph-edge"])] as const;

/**
 * - 1 sgu (starship geomorph grid unit) ~ 300x300px in original PNGs
 * - 1 sgu ~ 60x60 SVG units
 */
export const sguScalePngToSvgFactor = 0.2;

/** Should be `1 / sguScalePngToSvgFactor` */
export const sguScaleSvgToPngFactor = 5;
