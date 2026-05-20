/**
 * validateResult — runtime Zod check at Supabase boundaries.
 *
 * The DB types in src/integrations/supabase/types.ts are derived from the
 * Postgres schema, but TypeScript only enforces them at compile time. When
 * the live schema drifts (a column gets renamed, a column starts returning
 * null where it didn't before, an RPC's return shape changes), every query
 * site silently returns malformed data and screens crash deep in render —
 * far away from the actual cause.
 *
 * This helper sits between `unwrap()` and the consumer at the highest-stakes
 * read sites (profile, job detail, helper applications): it parses the
 * payload through a Zod schema, and if the parse fails it logs the issues
 * + a payload sample to Sentry so we hear about drift before users do.
 *
 * Crucially, a parse failure does NOT throw — we still hand the raw data
 * back to the consumer. The contract is "type guarantee at the boundary
 * is best-effort observability, not a hard gate" — flipping a feature to
 * blank-screen on schema drift would be worse than the silent-corruption
 * status quo. The Sentry alert is the signal we need to ship a fix.
 *
 *   const profile = validateResult(
 *     profileSchema,
 *     await unwrap(supabase.from("profiles").select(…)),
 *     "useProfile.fetchProfile",
 *   );
 */
import type { ZodSchema } from "zod";

// Sentry is dynamically imported to match the rest of the observability
// surface (see src/lib/errorLogger.ts) — keeps the SDK out of the initial
// bundle and lets the helper be called from any chunk without pulling
// ~30KB of vendor code into the loader.
async function captureDriftToSentry(
  context: string,
  issues: unknown,
  sample: unknown,
) {
  try {
    const { captureMessage } = await import("@sentry/react");
    captureMessage(`Schema drift at ${context}`, {
      level: "error",
      extra: { issues, sample },
    });
  } catch {
    /* observability must never break the app */
  }
}

export function validateResult<T>(
  schema: ZodSchema<T>,
  data: unknown,
  context: string,
): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    // Fire-and-forget — we don't want to await the Sentry round-trip on
    // the query path. Failures inside captureDriftToSentry are swallowed.
    void captureDriftToSentry(context, parsed.error.issues, data);
    // Return the raw payload so the screen still renders. The hypothesis
    // is that schema drift is usually additive (new nullable column) and
    // the consumer ignores the unknown fields — better to render slightly
    // stale than to blank-screen on every drift.
    return data as T;
  }
  return parsed.data;
}
