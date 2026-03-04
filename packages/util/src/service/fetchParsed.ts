import { z } from "zod";

export async function fetchParsed<T extends z.ZodTypeAny>(
  input: RequestInfo | URL,
  schema: T,
  init?: RequestInit,
): Promise<z.infer<T>> {
  const response = await fetch(input, init);

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const result = schema.safeParse(json);

  if (!result.success) {
    throw new Error(`Schema validation failed: ${z.prettifyError(result.error)}`);
  }

  return result.data;
}
