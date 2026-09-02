import { supabase } from "@/integrations/supabase/client";

/**
 * The force-update threshold, read from `platform_settings.min_supported_build`.
 *
 * WHY THIS EXISTS AT ALL. Push notifications turned out to need a NATIVE
 * rebuild to fix, and an iOS app cannot be hot-fixed while it sits in App
 * Review. So when a bad build ships there is no way to turn those users away —
 * they keep running the broken version until Apple clears a replacement. This
 * is the one lever that works in that window: raise the number, and the old
 * binaries stop letting anyone in.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS FILE FAILS **OPEN**, AND THAT IS THE OPPOSITE OF ITS NEIGHBOUR.
 *
 * `lib/featureFlags.ts` fails CLOSED on purpose: a dropped read there must not
 * lift a compliance gate, because nothing visibly breaks when a gate stops
 * gating. Read that file for the shape of the cache — TTL, in-flight dedupe,
 * a single quiet catch — because this one deliberately copies it. Then read
 * this paragraph, because the direction of the fallback is inverted and the
 * inversion is the entire safety property.
 *
 * A force-update gate that blocks when its own read fails is an outage you
 * cannot fix remotely. Supabase down, captive wifi, an airport hotspot, a
 * botched RPC deploy, a signature mismatch during the migration lag window —
 * every one of those would brick every native install at once, and the fix
 * would require shipping a new binary through App Review. That is precisely
 * the situation this feature exists to rescue, so it must never be the
 * situation this feature causes.
 *
 * Therefore EVERY failure mode resolves to 0, the documented off value:
 *   · the RPC errors or throws          → 0
 *   · there is no settings row          → 0
 *   · the column has not deployed yet   → 0  (undefined, no special case)
 *   · the value is null / NaN / a string that is not a number → 0
 *   · the value is negative or absurd   → 0
 * The ONLY way this returns a blocking threshold is an operator having
 * deliberately typed a positive integer into Admin → Settings.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Same 60s window as `featureFlags.ts`, for the same reason and one more.
 * The shared reason: this sits on a hot path where a round trip is felt
 * directly — here it is the app-start path, so the cost is paid in
 * time-to-first-screen on every launch. The extra reason: a short TTL is what
 * makes a re-check on foreground worth doing at all. Raising the threshold
 * during an incident reaches a phone that is merely backgrounded in about a
 * minute, instead of waiting for its owner to cold-start the app.
 */
const TTL_MS = 60_000;

/** The documented "gate off" value. Also the value every failure lands on. */
export const GATE_OFF = 0;

/** Admin → Settings caps its input here; a stored value above it is corrupt. */
const MAX_PLAUSIBLE_BUILD = 999_999;

let cached: { value: number; at: number } | null = null;
/** In-flight request, so a launch + an immediate resume do not fire two reads. */
let inFlight: Promise<number> | null = null;

/** Drop the cache — used by tests, and after an admin saves a new threshold. */
export function resetMinSupportedBuildCache() {
  cached = null;
  inFlight = null;
}

/**
 * Parse a native build identifier into a comparable integer.
 *
 * On iOS this is `CFBundleVersion` and on Android `versionCode`, both arriving
 * from `App.getInfo()` as a STRING. Android's is always an integer. Apple
 * merely *recommends* one and permits up to three dot-separated integers
 * ("1.0.4"), which cannot be meaningfully compared against the single integer
 * an operator types into Admin → Settings.
 *
 * So dotted forms return null and the gate stays open. That is the honest
 * answer rather than a guess: inventing a comparison (take the first
 * component? sum them?) would let a future build be blocked or admitted for a
 * reason nobody intended. Today's binary ships CFBundleVersion 5906 — a plain
 * integer — and if that ever changes, this turns itself off rather than
 * turning on wrongly.
 */
export function parseBuildNumber(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // Strictly digits. Rejects "", "1.0.4", "5906-beta", "1e3", "+5906", "NaN",
  // and anything with whitespace inside — all of which `Number()` would
  // happily coerce into something, several of them into a number that
  // compares.
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Coerce whatever the RPC handed back into a usable threshold, or `GATE_OFF`.
 * Kept separate from the fetch so every "unparseable means off" case is
 * testable without a network mock.
 */
export function normalizeMinBuild(raw: unknown): number {
  const parsed = parseBuildNumber(raw);
  if (parsed === null) return GATE_OFF;
  if (parsed > MAX_PLAUSIBLE_BUILD) return GATE_OFF;
  return parsed;
}

/**
 * The minimum build the platform currently admits, or 0 when the gate is off.
 *
 * Never rejects. Never throws. See the header for why that is not laziness.
 */
export async function readMinSupportedBuild(): Promise<number> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const { data, error } = await supabase.rpc("get_public_platform_settings");
      // The error is never dropped: it is thrown here so the single catch
      // below both logs it and lands on the safe answer, rather than being
      // silently ignored while `data` is read as null.
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      // `min_supported_build` arrives only once migration 20260901035235 has
      // deployed. Until then the key is simply absent, which normalizes to
      // GATE_OFF without a special case — the same shape featureFlags.ts uses
      // for its own deploy-lag window.
      const value = normalizeMinBuild(
        (row as { min_supported_build?: unknown } | null | undefined)?.min_supported_build,
      );
      cached = { value, at: Date.now() };
      return value;
    } catch (err) {
      // Logged, not swallowed, and deliberately not sent to `errorLogger`:
      // this runs on every cold start, so a flaky-network launch would write
      // an `error_logs` row per user per attempt for a condition that is
      // expected, self-healing, and by design has no user-visible effect. A
      // console line is enough to see it on a device or in the web console.
      console.warn("[minSupportedBuild] settings read failed — gate stays open:", err);
      // Cache the failure for the same TTL. Retrying on every call would turn
      // a Supabase outage into a request storm from every launched app.
      cached = { value: GATE_OFF, at: Date.now() };
      return GATE_OFF;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
