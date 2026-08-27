/**
 * Does Stripe actually consider this Connect account's IDENTITY verified?
 *
 * This is the only signal allowed to back a user-visible "ID verified" claim.
 * Getting it right matters: the badge is a safety signal on a marketplace that
 * sends strangers to people's homes.
 *
 * WHY NOT `payouts_enabled` — measured, not assumed. On the LIVE platform
 * account, two Connect accounts had `payouts_enabled: true` while their
 * identity was demonstrably NOT verified:
 *
 *   - acct_1TDz4k…  payouts_enabled: true,
 *                   individual.verification.status: "unverified",
 *                   details: "Provided identity information could not be
 *                   verified" (failed_keyed_identity)
 *   - acct_1TDyBU…  payouts_enabled: true, no DOB, no SSN last 4,
 *                   individual.verification.status: "unverified"
 *
 * Stripe enables payouts during a grace window and only *later* enforces the
 * identity fields. So `payouts_enabled` means "Stripe is willing to send money
 * for now", NOT "we checked who this is".
 *
 * WHY NOT `individual.verification.status` directly — for Express accounts
 * (`controller.requirement_collection === "stripe"`, which is the main path
 * here) Stripe does not expose the `verification` sub-object to the platform
 * at all; the `individual` person object comes back without it. Reading it
 * would therefore be silently false for most real users.
 *
 * WHAT WE USE INSTEAD — the requirements ledger, which IS uniform across
 * Express and Custom: identity is settled only when the account is live
 * (charges + payouts enabled, not disabled) AND Stripe is not still asking for
 * any identity field in ANY requirement bucket — currently_due, past_due,
 * eventually_due, or pending_verification, in both `requirements` and
 * `future_requirements`.
 *
 * `eventually_due` is included on purpose. A US individual account with
 * `individual.ssn_last_4` still eventually due has had, at most, a keyed
 * name/DOB/address match run against it — that is not a checked identity, and
 * this badge is a safety claim, so the strict reading is the honest one.
 */

/**
 * Structural shapes rather than `Stripe.Account`: this module is imported by
 * the browser-side unit test too, and a `https://esm.sh/...` type import is
 * unresolvable to `tsc -b`. The real Stripe types satisfy these.
 */
interface RequirementBuckets {
  currently_due?: string[] | null;
  past_due?: string[] | null;
  eventually_due?: string[] | null;
  pending_verification?: string[] | null;
  disabled_reason?: string | null;
}

export interface ConnectAccountIdentityShape {
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  requirements?: RequirementBuckets | null;
  future_requirements?: RequirementBuckets | null;
}

/** Requirement keys that describe WHO the account holder is. */
function isIdentityRequirement(key: string): boolean {
  return (
    key.startsWith("individual.") ||
    key.startsWith("representative.") ||
    key.startsWith("owners.") ||
    key.startsWith("person_") ||
    key.startsWith("company.verification")
  );
}

function bucketKeys(r: RequirementBuckets | null | undefined): string[] {
  if (!r) return [];
  return [
    ...(r.currently_due ?? []),
    ...(r.past_due ?? []),
    ...(r.eventually_due ?? []),
    ...(r.pending_verification ?? []),
  ];
}

export function stripeIdentityVerified(account: ConnectAccountIdentityShape): boolean {
  if (!account.charges_enabled || !account.payouts_enabled) return false;
  if (account.requirements?.disabled_reason) return false;

  const outstanding = [
    ...bucketKeys(account.requirements),
    ...bucketKeys(account.future_requirements),
  ];
  return !outstanding.some(isIdentityRequirement);
}
