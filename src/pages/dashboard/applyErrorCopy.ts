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
  "Cannot apply to your own job": "You can't apply to your own post.",
  "Job is no longer accepting applications": "This job isn't accepting applications anymore.",
  "Job not found": "This job is no longer available.",
  // enforce_application_credential_tier (20260824251000). The trigger's HINT
  // separates "licensed" from "licensed + insured", but PostgREST puts HINT in
  // `hint` and supabase-js surfaces `message`, so the hint never arrives — one
  // line has to cover both tiers.
  credential_tier_required:
    "You don't have the credentials this job requires. Add your license or insurance in your profile to apply.",
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
