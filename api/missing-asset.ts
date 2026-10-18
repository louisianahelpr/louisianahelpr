/**
 * Q1737: a MISSING file under /assets/ or /fonts/ answers 404 with
 * `Cache-Control: no-store`, never the year-long immutable header.
 *
 * WHY. vercel.json's `/assets/(.*)` and `/fonts/(.*)` header rules stamp
 * `public, max-age=31536000, immutable` on every response under those paths,
 * found or not: measured with curl -sI on www (2026-10-12 and again
 * 2026-10-17), a missing chunk answered 404 text/plain WITH that header. A
 * browser may keep a 404 that carries explicit freshness, so a chunk asked for
 * in a deploy's propagation window (Q199) could stay a cached 404 under its
 * URL. A header rule cannot test whether a file exists (`has`/`missing` read
 * request headers, cookies, query and host only).
 *
 * HOW. vercel.json rewrites /assets/(.*) and /fonts/(.*) here. A rewrite never
 * shadows a real file (Vercel checks the filesystem first), so only a path
 * with no file reaches this function, and a function's own Cache-Control
 * takes precedence over the vercel.json header rule (measured on a preview
 * deployment before this shipped: see Q1737 in docs/OPEN.md).
 * Guard: src/test/immutablePathsNeverServeTheSpa.test.ts.
 */
export const MISSING_ASSET_CACHE_CONTROL = "no-store";

export function missingAssetResponse(): Response {
  return new Response("Not Found\n", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": MISSING_ASSET_CACHE_CONTROL,
      "x-content-type-options": "nosniff",
    },
  });
}

export default {
  async fetch(_request: Request): Promise<Response> {
    return missingAssetResponse();
  },
};
