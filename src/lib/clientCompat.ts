import { supabase } from "@/integrations/supabase/client";

/**
 * Client compatibility epoch: which schema this bundle was written against.
 *
 * A bundle is frozen when it is built. The native app carries it inside the
 * binary, and a web tab keeps running what it loaded. When a migration takes
 * a privilege away from `authenticated`, every older bundle keeps selecting
 * what it may no longer read. Measured 2026-10-05: the 2026-10-01 TestFlight
 * bundle (release 693db745) got 42501 "permission denied for table
 * applications" on My Jobs and Applicants after 20261004191007 withheld three
 * applications columns.
 *
 * The database answers `client_compat_floor()`: the oldest epoch it still
 * serves. A bundle below it reloads (web, src/lib/staleClient.ts) or shows
 * "Update Helpr" (native, ForceUpdateGate).
 *
 * RAISE THIS in the same commit as the migration that raises the floor.
 * src/test/schemaBreakBumpsClientFloor.test.ts holds the two equal and fails
 * any migration that narrows authenticated privileges without a bump.
 */
export const CLIENT_COMPAT_EPOCH = 1;

/** The floor's "off" value: unknown, unreadable, or not deployed yet. */
export const FLOOR_UNKNOWN = 0;

const TTL_MS = 60_000;
const FORCED_MIN_AGE_MS = 5_000;
let cached: { value: number; at: number } | null = null;
let inFlight: Promise<number> | null = null;

export function resetClientCompatFloorCache() {
  cached = null;
  inFlight = null;
}

/** A sane positive integer, or FLOOR_UNKNOWN. */
export function normalizeFloor(raw: unknown): number {
  const n = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n < 1_000_000 ? n : FLOOR_UNKNOWN;
}

/**
 * Read the floor. Fails OPEN (FLOOR_UNKNOWN) on every error, including the
 * function not being deployed yet (PGRST202): a wrong "too old" blocks a
 * native user with no way out, a wrong "fine" costs one more error card.
 * Cached 60 s; `force` skips the cache (a 42501 just happened).
 */
export async function readClientCompatFloor(opts: { force?: boolean } = {}): Promise<number> {
  const now = Date.now();
  // Even a forced read reuses an answer under 5 s old: a burst of refused
  // reads (one screen firing several queries) is one request, not a storm.
  if (cached && now - cached.at < (opts.force ? FORCED_MIN_AGE_MS : TTL_MS)) return cached.value;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      // Cast: the generated types learn about this function only after the
      // migration deploys and types are regenerated.
      const rpc = supabase.rpc as unknown as (fn: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      const { data, error } = await rpc("client_compat_floor");
      if (error) throw error;
      const value = normalizeFloor(data);
      cached = { value, at: Date.now() };
      return value;
    } catch (err) {
      // Logged, not reported: a flaky launch would otherwise write an
      // error_logs row per user per resume for a condition that, by design,
      // changes nothing on screen.
      console.warn("[clientCompat] floor read failed; treating as current:", err);
      cached = { value: FLOOR_UNKNOWN, at: Date.now() };
      return FLOOR_UNKNOWN;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** True only when the floor is known and above this bundle. */
export const isBelowFloor = (floor: number, epoch: number = CLIENT_COMPAT_EPOCH): boolean =>
  floor > FLOOR_UNKNOWN && epoch < floor;
