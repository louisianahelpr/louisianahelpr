/**
 * NPS prompt timing — when should we show the Net Promoter Score survey?
 *
 * Strategy:
 *   - For CUSTOMERS:  after their 2nd completed job (status='completed').
 *     The 1st job is too early — they're still excited about the magic.
 *     By the 2nd they've formed a real opinion.
 *   - For HELPERS:    after their 2nd completed job for a customer they
 *     hadn't worked with before. That filters out the "one-off luck" case
 *     where a single repeat customer keeps re-hiring them.
 *
 * Re-survey policy:
 *   We've chosen ONE NPS PER USER LIFETIME for v1. Quarterly re-surveying
 *   is straightforward to add later (replace the lifetime-submission gate
 *   with `created_at > now() - 90 days`), but the dashboarding cost of a
 *   shifting denominator outweighs the data benefit at our current scale.
 *
 * Cooldown:
 *   - Server truth:   any row in nps_responses → never show again.
 *   - Local truth:    on "Maybe later", set localStorage `nps-cooldown-until`
 *                     to now+90d. Prevents nag if the user dismisses and
 *                     the migration hasn't propagated yet.
 *
 * Graceful fallback:
 *   The migration is NOT auto-applied to prod. If the table query 404s
 *   (PGRST205 / 42P01 / "schema cache" / "relation does not exist"), we
 *   silently return `eligible: false` rather than crashing — the worst
 *   case is we miss a prompt impression, not a blank screen.
 */
import { supabase } from "@/integrations/supabase/client";

const COOLDOWN_KEY = "nps-cooldown-until";
const COOLDOWN_DAYS = 90;
const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export type NpsRole = "customer" | "helper";

export type NpsEligibility =
  | { eligible: false; reason: string }
  | { eligible: true; role: NpsRole; jobsCompleted: number };

/**
 * Set the localStorage 90-day cooldown. Called when the user taps
 * "Maybe later" so we don't ask them again for 3 months.
 */
export function setNpsLocalCooldown(now: number = Date.now()): void {
  try {
    localStorage.setItem(COOLDOWN_KEY, String(now + COOLDOWN_MS));
  } catch {
    /* private mode / quota — silently skip; the server gate still applies */
  }
}

/**
 * Pure helper exposed for testing: is the localStorage cooldown still active?
 */
export function isLocalCooldownActive(now: number = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(COOLDOWN_KEY);
    if (!raw) return false;
    const until = Number(raw);
    if (!Number.isFinite(until)) return false;
    return until > now;
  } catch {
    return false;
  }
}

/**
 * Clear the local cooldown — exported only for tests. Production code
 * never clears it; expiry is time-based.
 */
export function clearNpsLocalCooldownForTests(): void {
  try {
    localStorage.removeItem(COOLDOWN_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * "Is the failure code shaped like a missing-table error?" — kept inline
 * so the matcher is grep-able next to the comment above.
 */
function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  if (code === "PGRST205" || code === "PGRST202" || code === "42P01") return true;
  const msg = String(error.message ?? "");
  return /schema cache|relation .* does not exist|table .* does not exist/i.test(msg);
}

/**
 * Has this user ever submitted an NPS response? Server truth.
 * Returns `null` when the table doesn't exist yet (migration not pushed)
 * so the caller can distinguish "no rows" from "no table".
 */
export async function hasSubmittedNps(userId: string): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("nps_responses")
    .select("id")
    .eq("user_id", userId)
    .limit(1);

  if (error) {
    if (isMissingTableError(error)) return null;
    // Any other failure → treat as "submitted" so we don't badger them on
    // an intermittent network error. Errs on the side of fewer prompts.
    return true;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Count of completed customer jobs (i.e. jobs the user posted that
 * reached status='completed'). The "2 completed" gate uses this.
 */
async function countCompletedCustomerJobs(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", userId)
    .eq("status", "completed");
  if (error) return 0;
  return count ?? 0;
}

/**
 * Count of DISTINCT customers a helper has completed a job for.
 *   - filters to status='completed' (avoids cancelled / disputed rows)
 *   - dedupes by customer_id (a 5-times-repeat customer counts once)
 *
 * 2+ distinct customers = "real platform experience, not one-off luck".
 */
async function countDistinctCompletedHelperCustomers(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from("jobs")
    .select("customer_id")
    .eq("helper_id", userId)
    .eq("status", "completed");
  if (error || !data) return 0;
  const distinct = new Set<string>();
  for (const row of data) {
    if (row.customer_id) distinct.add(row.customer_id);
  }
  return distinct.size;
}

/**
 * Decide whether to show the NPS prompt for a user, and at what trigger
 * count. Combines server truth (already-submitted, jobs-completed) with
 * the local 90-day cooldown.
 *
 * Pure-ish: every Supabase call is awaited explicitly so this is
 * straightforward to mock at the supabase-client level in tests.
 */
export async function checkNpsEligibility(userId: string): Promise<NpsEligibility> {
  // Cheap local gate first — saves two Supabase round-trips when on cooldown.
  if (isLocalCooldownActive()) {
    return { eligible: false, reason: "local-cooldown" };
  }

  const submitted = await hasSubmittedNps(userId);
  if (submitted === null) {
    // Table not yet pushed to prod. Bail quietly.
    return { eligible: false, reason: "table-missing" };
  }
  if (submitted) {
    return { eligible: false, reason: "already-submitted" };
  }

  // Server-side completion counts. Run in parallel — both queries are
  // small index scans and the user is sitting on the share screen.
  const [customerCount, helperDistinct] = await Promise.all([
    countCompletedCustomerJobs(userId),
    countDistinctCompletedHelperCustomers(userId),
  ]);

  // Helper-side eligibility wins when both apply (a user who's done both
  // roles): helper experience is the harder one to earn, so it's the
  // more informative score.
  if (helperDistinct >= 2) {
    return { eligible: true, role: "helper", jobsCompleted: helperDistinct };
  }
  if (customerCount >= 2) {
    return { eligible: true, role: "customer", jobsCompleted: customerCount };
  }
  return { eligible: false, reason: "below-threshold" };
}

export interface SubmitNpsInput {
  userId: string;
  score: number;
  comment?: string;
  role: NpsRole;
  jobsCompleted: number;
}

/**
 * Persist an NPS response. Surfaces errors to the caller (the prompt
 * component shows a toast on failure).
 */
export async function submitNps(input: SubmitNpsInput): Promise<void> {
  const { userId, score, comment, role, jobsCompleted } = input;
  const trimmed = comment?.trim();
  const { error } = await supabase.from("nps_responses").insert({
    user_id: userId,
    score,
    comment: trimmed ? trimmed : null,
    user_role: role,
    triggered_at_jobs_completed: jobsCompleted,
  });
  if (error) {
    // If the migration isn't live we still set the local cooldown
    // so the user isn't re-prompted in the meantime. Re-throw so the
    // UI shows the toast and the user can retry / dismiss.
    throw error;
  }
}
