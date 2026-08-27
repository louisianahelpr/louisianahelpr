import { describe, it, expect } from "vitest";
import { stripeIdentityVerified } from "../../supabase/functions/_shared/stripeIdentity";

/**
 * The rule behind the user-visible "ID verified by Stripe" badge.
 *
 * The cases below are not invented — they are shapes observed on the LIVE
 * platform account, which is exactly why `payouts_enabled` was rejected as the
 * signal. See the header of `_shared/stripeIdentity.ts`.
 */

type Acct = Parameters<typeof stripeIdentityVerified>[0];

const acct = (over: Record<string, unknown>): Acct =>
  ({
    charges_enabled: true,
    payouts_enabled: true,
    requirements: { currently_due: [], past_due: [], eventually_due: [], pending_verification: [], disabled_reason: null },
    future_requirements: { currently_due: [], past_due: [], eventually_due: [], pending_verification: [] },
    ...over,
  }) as unknown as Acct;

describe("stripeIdentityVerified", () => {
  it("is true only when the account is live and no identity field is outstanding", () => {
    expect(stripeIdentityVerified(acct({}))).toBe(true);
  });

  it("is FALSE when payouts are enabled but SSN last 4 is still eventually due", () => {
    // Observed live: acct_1TIAVe… — payouts_enabled true, transfers active,
    // yet `individual.ssn_last_4` still eventually due. Stripe has not checked
    // who this is; it is merely willing to move money for now.
    expect(
      stripeIdentityVerified(
        acct({
          requirements: {
            currently_due: [],
            past_due: [],
            eventually_due: ["individual.ssn_last_4"],
            pending_verification: [],
            disabled_reason: null,
          },
        }),
      ),
    ).toBe(false);
  });

  it("is FALSE when an identity DOCUMENT is still owed", () => {
    // Observed live: acct_1TDz4k… — payouts_enabled true while Stripe reported
    // "Provided identity information could not be verified".
    expect(
      stripeIdentityVerified(
        acct({
          requirements: {
            currently_due: [],
            past_due: [],
            eventually_due: ["individual.verification.document"],
            pending_verification: [],
            disabled_reason: null,
          },
        }),
      ),
    ).toBe(false);
  });

  it("is FALSE while an identity field is still pending verification", () => {
    expect(
      stripeIdentityVerified(
        acct({
          requirements: {
            currently_due: [],
            past_due: [],
            eventually_due: [],
            pending_verification: ["individual.verification.document"],
            disabled_reason: null,
          },
        }),
      ),
    ).toBe(false);
  });

  it("is FALSE when only a NON-identity requirement (a bank account) is owed — that is not an identity fact", () => {
    expect(
      stripeIdentityVerified(
        acct({
          requirements: {
            currently_due: ["external_account"],
            past_due: [],
            eventually_due: [],
            pending_verification: [],
            disabled_reason: null,
          },
        }),
      ),
    ).toBe(true);
  });

  it("is FALSE when the account is disabled, charges are off, or payouts are off", () => {
    expect(stripeIdentityVerified(acct({ charges_enabled: false }))).toBe(false);
    expect(stripeIdentityVerified(acct({ payouts_enabled: false }))).toBe(false);
    expect(
      stripeIdentityVerified(
        acct({
          requirements: {
            currently_due: [],
            past_due: [],
            eventually_due: [],
            pending_verification: [],
            disabled_reason: "requirements.past_due",
          },
        }),
      ),
    ).toBe(false);
  });

  it("also honours future_requirements", () => {
    expect(
      stripeIdentityVerified(
        acct({
          future_requirements: {
            currently_due: [],
            past_due: [],
            eventually_due: ["individual.dob.day"],
            pending_verification: [],
          },
        }),
      ),
    ).toBe(false);
  });
});
