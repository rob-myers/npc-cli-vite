import z from "zod";
import { warn } from "../legacy/generic";

/**
 * Compositional JSON parser for usage with other zod schemas.
 */
export const jsonParser = z.string().transform((str, _ctx) => {
  try {
    return JSON.parse(str);
  } catch (_e) {
    warn(`jsonParser: invalid JSON string: "${str}"`);
    return z.NEVER;
  }
});
