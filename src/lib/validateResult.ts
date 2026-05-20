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

// Build a PII-safe summary of the drifted payload. The Zod issues list
// is essential debug info and carries no payload values, but the raw
// `data` blob would leak whatever the query was reading — profile
// emails/names/locations, job descriptions, message bodies, etc. A single
// schema drift could ship every active user's PII to Sentry.
//
// We replace string values with `<redacted-string>`, numbers with
// `<number>`, and collapse nested objects/arrays to type tags. The shape
// (top-level key names + array lengths) is what an engineer actually
// needs to map the issues back to the failing query.
function summarizeShape(data: unknown): unknown {
  if (data == null) return data;
  if (Array.isArray(data)) {
    return {
      _array: true,
      length: data.length,
      first_keys:
        data.length > 0 &&
        typeof data[0] === "object" &&
        data[0] !== null &&
        !Array.isArray(data[0])
          ? Object.keys(data[0] as Record<string, unknown>)
          : null,
    };
  }
  if (typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([k, v]) => [
        k,
        typeof v === "string"
          ? "<redacted-string>"
          : typeof v === "number"
            ? "<number>"
            : typeof v === "boolean"
              ? v
              : v == null
                ? null
                : Array.isArray(v)
                  ? `<array[${v.length}]>`
                  : "<object>",
      ]),
    );
  }
  return typeof data;
}

// Sentry is dynamically imported to match the rest of the observability
// surface (see src/lib/errorLogger.ts) — keeps the SDK out of the initial
// bundle and lets the helper be called from any chunk without pulling
// ~30KB of vendor code into the loader.
async function captureDriftToSentry(
  context: string,
  issues: unknown,
  shape: unknown,
) {
  try {
    const { captureMessage } = await import("@sentry/react");
    captureMessage(`Schema drift at ${context}`, {
      level: "error",
      extra: { issues, shape },
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
    // Pass a shape summary instead of the raw payload — see summarizeShape.
    void captureDriftToSentry(
      context,
      parsed.error.issues,
      summarizeShape(data),
    );
    // Return the raw payload so the screen still renders. The hypothesis
    // is that schema drift is usually additive (new nullable column) and
    // the consumer ignores the unknown fields — better to render slightly
    // stale than to blank-screen on every drift.
    return data as T;
  }
  return parsed.data;
}
