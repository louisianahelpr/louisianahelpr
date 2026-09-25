/**
 * BR-024: deploy evidence that is read from the RUNNING function, not from
 * the Management API's metadata.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * `version`, `updated_at` and `ezbr_sha256` from the Management API are not
 * proof of what a function is serving. Measured 2026-09-22: health-check went
 * version 1305 -> 1307 and its ezbr_sha256 823bd331.. -> 7fc09e19.. inside nine
 * minutes with no deploy of any kind; about forty functions (the ones whose
 * entrypoint_path the platform rewrote to /app/...) churn like that all the
 * time. scripts/verify-functions-deployed.mjs can therefore prove a lost
 * deploy on the other functions, but can miss one on those forty.
 *
 * ── How ─────────────────────────────────────────────────────────────────────
 * Every function's entrypoint calls `serve()` from this file instead of
 * `Deno.serve` / std's `serve`. `BUILD_STAMP` below is the committed
 * placeholder; .github/workflows/functions-deploy.yml overwrites it right
 * before each `supabase functions deploy <fn>` with
 * `<fn>@<content hash of supabase/functions/<fn>/ + _shared/>`
 * (scripts/lib/edgeBuildStamp.mjs). After the deploy, the workflow sends every
 * function an OPTIONS request carrying `x-lh-build-probe` and compares the
 * `x-lh-build` header it answers with the hash computed from the repo at HEAD.
 * A function still serving an older build answers an older hash (or none), and
 * the run fails. src/test/edgeBuildStamp.test.ts fails when a function stops
 * going through this wrapper.
 *
 * The probe is answered BEFORE the function's own handler runs, so it cannot
 * charge, send, or sweep anything, and it is an OPTIONS request because the
 * gateway lets OPTIONS through without a JWT (measured 2026-09-25 against
 * create-payment, health-check and stripe-webhook: all three returned their
 * own 200 CORS preflight to an unauthenticated OPTIONS). The stamp is a content
 * hash of public-repo source, so exposing it discloses nothing.
 */

// Rewritten at deploy time by scripts/edge-build-stamp.mjs. Keep it on ONE
// line in exactly this shape; the writer replaces the string literal.
export const BUILD_STAMP = "unstamped";

/** Response header that carries the stamp. */
export const BUILD_HEADER = "x-lh-build";
/** Request header that asks for the stamp. Only meaningful on OPTIONS. */
export const BUILD_PROBE_HEADER = "x-lh-build-probe";

// deno-lint-ignore no-explicit-any
type Handler = (req: Request, info: any) => Response | Promise<Response>;

/** The build-probe answer for `req`, or null when `req` is not a probe. */
export function buildProbeResponse(req: Request): Response | null {
  if (req.method !== "OPTIONS" || !req.headers.has(BUILD_PROBE_HEADER)) return null;
  return new Response(null, {
    status: 204,
    headers: { [BUILD_HEADER]: BUILD_STAMP, "cache-control": "no-store" },
  });
}

/**
 * Drop-in for `Deno.serve(handler)` and std's `serve(handler)`: answers the
 * build probe, and hands every other request to `handler` unchanged.
 */
export function serve(handler: Handler) {
  return Deno.serve((req, info) => buildProbeResponse(req) ?? handler(req, info));
}
