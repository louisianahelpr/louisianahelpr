/**
 * onboardingTourCompletion — where "this account has seen the Welcome tour"
 * actually lives.
 *
 * It used to live ONLY in device storage (`helpr_onboarding_<uid>` through
 * safeStorage). Device storage does not survive a reinstall or a fresh
 * TestFlight build, so an account that finished onboarding long ago was shown
 * the whole seven-step tour again, 1.5s after the dashboard settled, on every
 * clean install — and on every new device it ever signed in on.
 *
 * Completion is a fact about the ACCOUNT. It is now stamped on
 * `profiles.onboarding_tour_completed_at` (migration
 * 20260909175426_account_scoped_onboarding_tour_completion), and that column is
 * the source of truth. Device storage is kept only as a fast local HINT so the
 * card cannot flash for someone who just tapped through it while the network
 * round-trip is in flight.
 *
 * DEPLOY-LAG. Migrations land on merge to main and the bundle can reach a
 * browser before `db push` finishes. In that window PostgREST does not know the
 * column and answers 42703 / PGRST204 (and PGRST202 for a not-yet-deployed
 * function). That must never throw and must never be read as "not completed" —
 * so it is reported as `"unavailable"` and the caller falls back to the device
 * hint, which is exactly today's behaviour. Every OTHER error is reported as
 * `"error"`; the caller treats that as "don't know", and the tour stays hidden
 * for that session rather than re-showing on a flaky connection. Never
 * `{ data }`-only: `unwrap()` handles the read, `unwrapMutation` the write.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { unwrapMutation } from "@/lib/mutationResult";
import { report } from "@/lib/errorLogger";

/** PostgREST/Postgres codes that mean "the schema change hasn't deployed yet". */
const SCHEMA_NOT_DEPLOYED = new Set(["42703", "PGRST204", "PGRST202"]);

const COLUMN = "onboarding_tour_completed_at";

function isSchemaLag(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code && SCHEMA_NOT_DEPLOYED.has(code)) return true;
  const message = (err as { message?: string } | null)?.message ?? "";
  // Belt and braces: PostgREST's schema-cache miss names the column in prose
  // and has historically varied its code between versions.
  return message.includes(COLUMN) && /could not find|does not exist/i.test(message);
}

export type TourCompletionLookup =
  /** The account has a completion stamp — never show the tour. */
  | { status: "completed" }
  /** The account row exists and has no stamp — the tour has never been finished. */
  | { status: "not_completed" }
  /** The column isn't deployed yet — caller should fall back to the device hint. */
  | { status: "unavailable" }
  /** Anything else (offline, RLS, no profile row). Caller should not show the tour. */
  | { status: "error" };

/** Read the account's completion stamp. Never throws. */
export async function fetchTourCompletion(userId: string): Promise<TourCompletionLookup> {
  try {
    // `maybeSingle` because a profile row can legitimately be absent for a
    // fraction of a second right after signup — that is not an error, but it
    // is also not evidence the tour was completed.
    const row = unwrap(
      await supabase
        .from("profiles")
        .select(COLUMN)
        .eq("user_id", userId)
        .maybeSingle(),
    ) as { onboarding_tour_completed_at: string | null } | null;

    if (!row) return { status: "error" };
    return row.onboarding_tour_completed_at
      ? { status: "completed" }
      : { status: "not_completed" };
  } catch (err) {
    if (isSchemaLag(err)) return { status: "unavailable" };
    report(err, {
      severity: "warning",
      tags: { kind: "onboarding_tour_completion_read" },
      context: { userId },
    });
    return { status: "error" };
  }
}

/**
 * Stamp completion on the account. Never throws — failing to persist must not
 * break the dismissal the user just performed (the device hint already holds
 * it, and the next dashboard visit retries via the self-heal path).
 *
 * `.select("id")` + `unwrapMutation` on purpose: an UPDATE that matches zero
 * rows returns `{ data: [], error: null }`, so without the row count a
 * completion silently lost to RLS or a missing profile row would read as
 * success and the tour would come back on the next reinstall — the exact bug
 * this change exists to close.
 */
export async function markTourCompleted(userId: string): Promise<boolean> {
  try {
    unwrapMutation(
      await supabase
        .from("profiles")
        .update({ [COLUMN]: new Date().toISOString() })
        .eq("user_id", userId)
        .select("id"),
      {
        action: "save that you finished the welcome tour",
        context: { userId },
      },
    );
    return true;
  } catch (err) {
    if (isSchemaLag(err)) return false; // deploy-lag window; retried next visit.
    report(err, {
      severity: "warning",
      tags: { kind: "onboarding_tour_completion_write" },
      context: { userId },
    });
    return false;
  }
}
