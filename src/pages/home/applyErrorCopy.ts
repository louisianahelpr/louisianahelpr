/**
 * The map from a server refusal to the sentence the helper reads.
 *
 * Extracted from `useApplyFlow.ts` on 2026-09-07 for one reason: one of these
 * entries can no longer be an exact string, and a lookup with a fallback rule
 * in it needs a test more than it needs to be inline.
 *
 * WHY THE DAILY-LIMIT ENTRY IS A PREFIX. `enforce_application_limit` used to
 * raise a fixed sentence naming 15, because 15 was compiled into the trigger.
 * The cap is now an admin setting (`platform_settings.daily_application_cap`,
 * default NULL = unlimited) and the trigger interpolates whatever is
 * configured — "…limit (15)…", "…limit (3)…", or nothing at all when the cap
 * is off. An exact-string key would have matched none of those and the helper
 * would have got the generic "something went wrong, tap retry" toast for a
 * refusal that re-fails identically on every retry. That is precisely the
 * failure mode the original comment in useApplyFlow warned about; the cap
 * becoming configurable is what finally triggered it.
 *
 * The stable part of the sentence is everything before the number, so that is
 * what is matched. The copy shown deliberately does NOT name a count — the
 * helper cannot act on the number and the operator can change it at any time.
 *
 * Everything not resolved here falls through to the generic retry toast, so a
 * miss is not silent-but-harmless: it re-offers a retry for a deterministic
 * refusal. Add entries, do not rely on the fallback.
 */

const EXACT: Record<string, string> = {
  "Already applied to this job": "You've already applied to this job.",
  // Two engines, one sentence. `apply_to_job` raises the prose version below;
  // the BEFORE INSERT trigger raises the terse code (20260921190002, guard C3),
  // and the trigger is what refuses the client's direct-INSERT fallback path
  // (useApplyFlow's PGRST202 branch) and any raw PostgREST call. Which engine
  // answered is not something the helper can act on, so both resolve to the
  // same line — the same reasoning as the daily-limit prefix below.
  "Cannot apply to your own job": "You can't apply to your own post.",
  cannot_apply_to_own_job: "You can't apply to your own post.",
  "Job is no longer accepting applications": "This job isn't accepting applications anymore.",
  "Job not found": "This job is no longer available.",
  // enforce_application_credential_tier (20260824251000). The trigger's HINT
  // separates "licensed" from "licensed + insured", but PostgREST puts HINT in
  // `hint` and supabase-js surfaces `message`, so the hint never arrives — one
  // line has to cover both tiers.
  credential_tier_required:
    "You don't have the credentials this job requires. Add your license or insurance in your profile to apply.",

  /*
   * THE REST OF THE TRIGGER VOCABULARY, added 2026-09-21.
   *
   * `enforce_application_job_state` raises eight codes and `enforce_ban_gate`
   * raises a ninth; only two of them were mapped. Every other one fell through
   * to the generic "Couldn't send your application through — tap retry" — and
   * every one of them is DETERMINISTIC, so the retry it offers re-fails
   * identically. The file's own header warned about exactly this ("a miss is
   * not silent-but-harmless"); the vocabulary simply grew past the map.
   *
   * The list was DERIVED, not recalled: read out of the live trigger bodies on
   * prod (`pg_get_functiondef` over every non-internal trigger on
   * `applications`), which is how it turned out to be eight missing and not the
   * six that had been reported. `applyErrorCodeCoverage.test.ts` now derives
   * the same inventory from the migrations and fails when a new code has no
   * copy, so this cannot silently fall behind again.
   *
   * None of these offers a retry, because none of them will succeed on one.
   * Each says what happened and, where the helper can do something, what.
   */

  // The poster deleted their account; the job row survives, anonymised.
  job_has_no_owner: "The person who posted this job has closed their account.",
  // Status moved off `open` — filled, cancelled, already in progress.
  job_not_open: "This job isn't accepting applications anymore.",
  // A direct offer to a specific Helpr is pending. It reopens if they decline
  // or it expires, so this is the one refusal worth coming back for.
  job_reserved_for_another_helper:
    "This job is being held for another Helpr right now. It may open up if they pass.",
  // The paid early-access perk. Say what it is plainly — a member sees the job
  // first and everyone else sees it shortly. Naming the window would be a
  // number the client cannot know.
  job_in_early_access_window:
    "This job is in early access for members right now. It opens to everyone shortly.",
  job_date_has_passed: "The date for this job has already passed.",
  job_expired: "This posting has expired.",
  job_not_available: "This job is no longer available.",
  // C10 (Q341): helper and poster are blocked, in either direction. Worded so
  // it does not say who blocked whom — same line either way.
  applicant_blocked: "This job isn't available to you.",
  // enforce_ban_gate. Deliberately vague about WHY: the reason belongs in the
  // email and the account screen, not in a toast on a job card.
  account_restricted:
    "Your account can't apply to jobs right now. Check your email or your profile for details.",
};

/**
 * Prefix rules, applied only after every exact key has missed. Ordered, first
 * match wins — keep them mutually exclusive rather than relying on the order.
 */
const PREFIXES: { prefix: string; copy: string }[] = [
  {
    // enforce_application_limit. The cap is interpolated, so only the head of
    // the sentence is stable. Deliberately the SAME copy as the RPC's
    // `rate_limit_day` branch in useApplyFlow: both mean "you are done applying
    // for today", and which engine refused is not something the helper can act
    // on. Deliberately WITHOUT the count, for the same reason as before —
    // naming a number would pick a side between two engines the client cannot
    // see, and the number is now an operator setting that can change.
    prefix: "You have reached the daily application limit",
    copy: "You've hit today's application limit — check back tomorrow.",
  },
];

/** The helper-facing sentence for a server refusal, or null to fall through. */
export function resolveApplyErrorCopy(message: string | null | undefined): string | null {
  if (!message) return null;
  const exact = EXACT[message];
  if (exact) return exact;
  for (const rule of PREFIXES) {
    if (message.startsWith(rule.prefix)) return rule.copy;
  }
  return null;
}

/**
 * The server saying this helper already has an application on this job:
 * apply_to_job's RAISE, or UNIQUE(job_id, helper_id) (23505) refusing the
 * direct-INSERT fallback. useApplyFlow reads it as SUCCESS when the previous
 * attempt's outcome was unknown (Q269): a lost response, then a retry.
 */
export function isAlreadyAppliedRefusal(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  return code === "23505" || message === "Already applied to this job";
}
