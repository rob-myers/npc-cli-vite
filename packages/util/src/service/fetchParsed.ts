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

/**
 * Override cache in development
 */
export function getDevCacheBustQueryParam() {
  return import.meta.env.DEV ? `?v=${Date.now()}` : "";
}

/** As above, onto a url which may already carry a query — e.g. a bundler's asset url */
export function devCacheBust(url: string) {
  return import.meta.env.DEV ? `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}` : url;
}
