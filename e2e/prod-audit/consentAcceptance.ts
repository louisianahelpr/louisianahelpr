/**
 * THE ONE WRITE EVERY PROD-AUDIT FIREWALL HAS TO LET THROUGH — AND NOTHING ELSE.
 *
 * `TermsReconsentDialog`'s acceptance — `PATCH /rest/v1/profiles` carrying
 * ONLY `terms_version_accepted` + `terms_accepted_at` — is not an admin
 * action, a money move or anything a presser could stumble into: it is the
 * tester's own consent record, on the tester's own row, and it is the ONLY way
 * out of a non-dismissible gate that otherwise covers every screen behind it
 * (see `clearConsentGate` in harness.ts). Refusing it is how run 35692221560
 * left `admin@louisianahelpr.com` at `terms_version_accepted = ''`.
 *
 * WHY THE BODY'S KEYS ARE CHECKED, NOT JUST "MENTIONS terms_version_accepted"
 * (2026-11-03). Complete Profile's save is ALSO a `PATCH /rest/v1/profiles`
 * whose body carries `terms_version_accepted` — next to `full_name`,
 * `location`, `zip_code`, `parish` and `accepted_terms_at`
 * (src/pages/auth/CompleteProfile.tsx). The old substring test let that save
 * through every firewall as if it were a consent pin, so a sweep or explore
 * signed in as the shared `incomplete` seed account could complete it on prod
 * — and every Journeys leg that needs an incomplete account then failed until
 * the account was deleted and re-created. A consent pin writes the two
 * columns the dialog writes; a body with any other key is a profile edit and
 * is refused like every other write.
 *
 * Pure (no Playwright import) so src/test/consentFirewallLetsEventThrough.test.ts
 * runs it.
 */

/** Exactly the columns TermsReconsentDialog's acceptance writes. */
export const CONSENT_PIN_COLUMNS: ReadonlySet<string> = new Set(["terms_version_accepted", "terms_accepted_at"]);

function bodyKeys(body: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return Object.keys(parsed);
  } catch {
    // Not JSON: not the dialog's write, so refuse it.
    return null;
  }
}

export function isConsentAcceptance(method: string, pathname: string, body: string | null): boolean {
  if (!body) return false;
  if (method === "PATCH" && /\/rest\/v1\/profiles$/.test(pathname)) {
    const keys = bodyKeys(body);
    return !!keys && keys.includes("terms_version_accepted") && keys.every((k) => CONSENT_PIN_COLUMNS.has(k));
  }
  // OA-009: the dialog's append-only consent EVENT, written right after the pin.
  // Refusing it left the admin test account pinned to "Sep 2026" with zero
  // `legal_acceptances` rows (2026-09-24 01:14Z press run): the pin-without-event
  // state OA-009 is about, manufactured by the harness.
  if (method === "POST" && /\/rest\/v1\/legal_acceptances$/.test(pathname)) return body.includes("terms_version");
  return false;
}
