import z from "zod";

/**
 * Compositional JSON parser for usage with other zod schemas.
 */
export const jsonParser = z.string().transform((str, _ctx) => {
  try {
    return JSON.parse(str);
  } catch (_e) {
    console.warn("Invalid JSON string:", str);
    return z.NEVER;
  }
});
