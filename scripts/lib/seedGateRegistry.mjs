/**
 * The launch switch's surface registry, read without a TypeScript toolchain
 * (scripts/launch-go.mjs runs this on launch day, Q552).
 *
 * Pure functions over source text, so src/test/launchGoSeedRegistry.test.ts
 * can grade them against the real registry and the real migration tree.
 *
 * Two defects this module exists to keep fixed (found 2026-10-07, dry run of
 * `npm run launch:go`, which FAILED its own precondition on a clean tree):
 *   1. The registry regex required `{ surface, object }` with nothing after
 *      `object`, so an entry carrying `via:` (deliver_parish_match_alert, which
 *      asks the gate through job_announceable_to) was silently not read.
 *   2. Discovery only ever ADDED a caller, and removed one only on DROP. A
 *      later CREATE OR REPLACE whose body no longer names the gate left the
 *      object counted as a caller forever (get_jobs_for_my_applications
 *      named it once in 20260915045110 and not since), so the launch-day
 *      check failed on objects that do not consult the gate at all.
 */

/** Every entry of SEED_GATED_SURFACES in `src`, in source order. */
export function parseSeedGateRegistry(src) {
  const start = src.indexOf("export const SEED_GATED_SURFACES");
  if (start < 0) return [];
  const end = src.indexOf("] as const", start);
  const block = src.slice(start, end < 0 ? src.length : end);
  const out = [];
  // One object literal per entry; keys may be split across lines and an
  // optional `via` may follow `object`. Comments between entries never
  // contain `{ surface:`, so the match is anchored on that key.
  const entry = /\{\s*surface:\s*"([^"]+)",\s*object:\s*"([^"]+)"\s*(?:,\s*via:\s*"([^"]+)"\s*)?,?\s*\}/g;
  for (const m of block.matchAll(entry)) {
    out.push(m[3] ? { surface: m[1], object: m[2], via: m[3] } : { surface: m[1], object: m[2] });
  }
  return out;
}

/** How many entries the registry block holds, counted by its `surface:` keys. */
export function countSeedGateRegistryKeys(src) {
  const start = src.indexOf("export const SEED_GATED_SURFACES");
  if (start < 0) return 0;
  const end = src.indexOf("] as const", start);
  const block = src.slice(start, end < 0 ? src.length : end);
  return [...block.matchAll(/\bsurface:\s*"/g)].length;
}

/**
 * Every object whose NEWEST surviving definition calls `authority`, replaying
 * the migrations in the order given (filename order = chronological).
 *
 * @param {{ name: string, sql: string }[]} migrations
 * @param {string} authority e.g. "public.seed_jobs_hidden_publicly"
 */
export function discoverGateCallers(migrations, authority) {
  const header = /CREATE (?:OR REPLACE )?(?:FUNCTION|VIEW)\s+(public\.\w+)/gi;
  // A call, schema-qualified or not: open_jobs_browse's newest body (a
  // pg_get_viewdef paste, 20261006023437) says `seed_jobs_hidden_publicly()`.
  const bare = authority.replace(/^public\./i, "");
  const call = new RegExp(`(?<![\\w.])(?:public\\.)?${bare}\\s*\\(`, "i");
  const callers = new Set();
  for (const { sql } of migrations) {
    const heads = [...sql.matchAll(header)];
    heads.forEach((h, i) => {
      const body = sql.slice((h.index ?? 0) + h[0].length, i + 1 < heads.length ? heads[i + 1].index : sql.length);
      const obj = h[1].toLowerCase();
      // The newest definition decides, in both directions.
      if (call.test(body)) callers.add(obj);
      else callers.delete(obj);
    });
    for (const d of sql.matchAll(/DROP\s+(?:FUNCTION|VIEW)\s+(?:IF EXISTS\s+)?(public\.\w+)/gi)) {
      callers.delete(d[1].toLowerCase());
    }
  }
  callers.delete(authority.toLowerCase()); // the authority is not its own consumer
  return callers;
}

/**
 * What a live definition must name for a registered surface to count as
 * gated: the flag key itself, or, for a `via` entry, the gated predicate it
 * delegates to (whose own row is checked for the flag key).
 */
export function liveGateNeedle(entry, flagKey) {
  return entry.via ? entry.via.replace(/^public\./, "") : flagKey;
}
