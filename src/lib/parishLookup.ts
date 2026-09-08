import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

/**
 * Why this file returns a STATUS and not just a string.
 *
 * `profiles.parish` is the location mechanism that works for EVERY member.
 * `profiles.latitude/longitude` exist and are written from device geolocation,
 * but only for members who grant the permission — parish is what places
 * everyone else, and the ZIP is the only input that produces it.
 * `get_ranked_open_jobs` ranks on parish and the helper job-match fan-out
 * matches on `p.parish = NEW.parish`. A member with a NULL parish is reachable
 * by nothing and knows nothing about it, however good their GPS is.
 *
 * Until 2026-09-06 this module collapsed four very different outcomes into one
 * `null`: not enough digits, the RPC failed, the RPC succeeded but Louisiana
 * has no such ZIP, and "we resolved it". The caller therefore could not tell
 * "your ZIP isn't one we know" from "the network hiccuped", so it said nothing
 * in both cases — and a signup from an unlisted ZIP completed with a NULL
 * parish, no error, no log, no way for the person or the operator to find out.
 * The table it reads was 252 of Louisiana's 720 ZIPs at the time, so that was
 * not a rare edge: it was two thirds of the state.
 *
 * `resolveParishByZip` is the honest API. `lookupParishByZip` is kept as the
 * thin string-or-null wrapper for callers that genuinely only want the value.
 */
export type ParishResolution =
  /** The ZIP is a known Louisiana ZIP. `parish` is safe to store. */
  | { status: "resolved"; parish: string }
  /** Fewer than 5 digits typed. Not an error — the user is mid-input. */
  | { status: "incomplete" }
  /**
   * Five digits, the lookup ran, and Louisiana has no such ZIP. The one case
   * that must be surfaced: it is either a typo or an out-of-state address, and
   * either way this person will be invisible to the feed if they proceed.
   */
  | { status: "unknown-zip"; zip: string }
  /**
   * The lookup itself failed. Say NOTHING to the user — we have no evidence
   * their ZIP is wrong, and accusing them because our own RPC broke is worse
   * than staying quiet. Already reported to `error_logs`.
   */
  | { status: "lookup-failed"; zip: string };

/**
 * Resolves a Louisiana ZIP to its parish, distinguishing "not a Louisiana ZIP"
 * from "the lookup broke".
 *
 * Accepts any string — non-digits are stripped, only the first 5 digits used.
 */
export async function resolveParishByZip(
  zip: string | null | undefined,
): Promise<ParishResolution> {
  const cleaned = (zip ?? "").replace(/\D/g, "").slice(0, 5);
  if (cleaned.length !== 5) return { status: "incomplete" };
  try {
    const { data, error } = await supabase.rpc("get_parish_for_zip", { p_zip: cleaned });
    if (error) {
      report(error, { severity: "warning", tags: { source: "parishLookup.rpc" } });
      return { status: "lookup-failed", zip: cleaned };
    }
    const parish = (data as string | null) || null;
    if (parish) return { status: "resolved", parish };
    // The operator-facing half of the guard. The user gets an inline warning on
    // the field; this is how anyone ELSE finds out — a real person typed a ZIP
    // the table cannot place, which is either an out-of-state signup (useful to
    // know) or a hole in `louisiana_zip_parishes` (urgent to know). Warning,
    // not error: it is a legitimate outcome for a Texas ZIP, and it must not
    // page anyone.
    report(new Error(`ZIP ${cleaned} resolved to no Louisiana parish`), {
      severity: "warning",
      tags: { source: "parishLookup.unknownZip", zip: cleaned },
    });
    return { status: "unknown-zip", zip: cleaned };
  } catch (err) {
    report(err, { severity: "warning", tags: { source: "parishLookup" } });
    return { status: "lookup-failed", zip: cleaned };
  }
}

/**
 * Resolves a Louisiana ZIP code to its parish. Returns null if not found.
 *
 * Prefer `resolveParishByZip` in UI that can show the user something — this
 * wrapper cannot tell an unknown ZIP from a failed lookup, which is the exact
 * ambiguity that let unreachable accounts be created in silence.
 */
export async function lookupParishByZip(zip: string | null | undefined): Promise<string | null> {
  const result = await resolveParishByZip(zip);
  return result.status === "resolved" ? result.parish : null;
}
