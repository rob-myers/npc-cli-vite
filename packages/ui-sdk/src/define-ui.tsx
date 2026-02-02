import type { UiPackageDef } from ".";

export const defineUi = <T extends UiPackageDef>(uiDef: T) => {
  return uiDef;
};
