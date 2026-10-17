// Client-side mirror of supabase/functions/_shared/legalVersions.ts.
// The edge runtime (Deno) can't import the Vite src/ tree, so these
// constants exist in two places by necessity. A version bump here fires
// the Terms re-consent modal on the next authed load for any user whose
// profiles.terms_version_accepted no longer matches — see
// src/components/TermsReconsentDialog.tsx.
//
// When a policy is materially updated, bump ALL of:
//   1. supabase/functions/_shared/legalVersions.ts (edge)
//   2. this file (client)
//   3. src/pages/info/legal/legalSections.ts LAST_UPDATED[key] (rendered date)
// The parity test at legalVersions.parity.test.ts guards drift.

// Always "Mon YYYY", the month it is published, and only ever later than the
// last one: the database ranks it that way and refuses an acceptance of an
// older or a future month (tr_keep_newest_terms_acceptance).
export const LATEST_TERMS_VERSION = "Oct 2026";

// The Privacy Policy is versioned on its own (Q289): legal_acceptances records
// both, and a Terms-only bump must not claim a Privacy version that never existed.
export const LATEST_PRIVACY_VERSION = "Jun 2026";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 2026" -> 202610 (comparable), or null for anything that is not "Mon YYYY". */
export function termsVersionRank(v: string | null | undefined): number | null {
  const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1]);
  return mon < 0 ? null : Number(m[2]) * 100 + mon + 1;
}

/**
 * Has this account accepted the current Terms, or NEWER ones? A build older
 * than the member's last acceptance (an iPhone not yet updated, a stale
 * checkout's script) must not call a newer acceptance stale: with `!==` it
 * prompted, and its I Agree wrote its own OLDER version, which put the
 * member's current devices back behind the re-agree dialog (2026-10-17,
 * press-every-control 39014836855; Q?schedule-double-modal). The database
 * keeps the newer version too (tr_keep_newest_terms_acceptance).
 */
export function termsAcceptanceIsCurrent(accepted: string | null | undefined, latest: string = LATEST_TERMS_VERSION): boolean {
  if (accepted === latest) return true;
  const held = termsVersionRank(accepted);
  const ours = termsVersionRank(latest);
  return held !== null && ours !== null && held >= ours;
}
