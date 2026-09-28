/**
 * A hashed asset gone past asset-history's retention. A function, since `_headers` would give any
 * static or redirect answer under `/assets/*` its year-long `immutable`, pinning the miss.
 */
export default async () =>
  new Response("Not found: a later deploy removed this asset. Reload the page.\n", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

// runs only when no static file matches, and before `_redirects`
export const config = { path: "/assets/*", preferStatic: true };
