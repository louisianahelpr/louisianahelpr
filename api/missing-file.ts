/**
 * Q1737: the answer for a file under /assets/ or /fonts/ that this deploy does
 * not have.
 *
 * vercel.json marks everything under those two paths `Cache-Control: public,
 * max-age=31536000, immutable`, because a real file there is content-hashed
 * and never changes. The rule matches the PATH, found or not, so a missing
 * file's 404 carried the same one-year immutable header (measured on www
 * 2026-10-12 with curl -sI). A browser may keep that 404, so a chunk asked for
 * in a deploy's propagation window (Q199) could stay a cached 404 under a URL
 * that exists a minute later.
 *
 * vercel.json rewrites /assets/* and /fonts/* here. Vercel checks the
 * filesystem before rewrites (measured 2026-10-15: /robots.txt is served as the
 * file although the SPA catch-all rewrite matches it), so a real file never
 * reaches this function. This answers 404 with `no-store`; a function's own
 * Cache-Control is what Vercel sends even where a vercel.json rule sets one
 * for the same path (measured 2026-10-15: /api/uptime-heartbeat answers
 * `cache-control: no-store` under the site-wide max-age=0 rule).
 * Guard: src/test/immutablePathsNeverServeTheSpa.test.ts; live check:
 * scripts/probes/missing-asset-not-cached.mjs.
 */
export default {
  fetch(): Response {
    return new Response("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "cdn-cache-control": "no-store",
        "x-robots-tag": "noindex",
      },
    });
  },
};
