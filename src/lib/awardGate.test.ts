// The client acceptance gate must not refuse someone the SERVER would hire.
//
// It did. Measured against prod 2026-09-06, one live non-seed profile held:
//
//     idv_status               = 'verified'   (Stripe Identity: doc + selfie)
//     stripe_identity_verified = false        (Stripe Connect requirement flag)
//     stripe_payouts_enabled   = true
//     helper_award_block_reason(user_id) = NULL      <- the database says HIRE
//
// `awardBlockReasonFromStatus` read only the Connect flag, so it answered
// `helper_identity_unverified` and put that person in front of AwardGateDialog
// ("Stripe Is Still Verifying You") with a CTA that opens a Stripe Account Link
// having nothing left to collect. A dead end, on an account that was done.
//
// The server's rule since migration 20260907013734 is EITHER verdict. These
// tests pin the client to that rule, and pin the fail-closed direction so the
// fix cannot be read as "identity is now optional".
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isIdentityVerified,
  awardBlockReasonFromStatus,
  awardBlockFromError,
  type AwardGateStatus,
} from "./awardGate";
import { isIdvRequirementPaused } from "@/lib/featureFlags";

vi.mock("@/lib/featureFlags", () => ({
  isIdvRequirementPaused: vi.fn(async () => false),
}));

/** Payout-ready in every respect, so only the identity arm is under test. */
const PAYOUT_READY: AwardGateStatus = {
  connected: true,
  details_submitted: true,
  payouts_enabled: true,
};

beforeEach(() => {
  vi.mocked(isIdvRequirementPaused).mockResolvedValue(false);
});

describe("isIdentityVerified accepts either verdict, like the server", () => {
  it("accepts the Stripe Connect verdict alone", () => {
    expect(isIdentityVerified({ connectIdentityVerified: true, idvStatus: null })).toBe(true);
  });

  it("accepts the Stripe Identity verdict alone — the live case that was refused", () => {
    expect(
      isIdentityVerified({ connectIdentityVerified: false, idvStatus: "verified" }),
    ).toBe(true);
  });

  it.each(["pending", "processing", "manual_review", "failed", "skipped", "not_started"])(
    "does NOT accept idv_status %s",
    (status) => {
      expect(isIdentityVerified({ connectIdentityVerified: false, idvStatus: status })).toBe(false);
    },
  );

  it("fails closed when neither verdict is readable", () => {
    // Absent is not permission. Both fields undefined must never come back true.
    expect(isIdentityVerified({})).toBe(false);
    expect(isIdentityVerified({ connectIdentityVerified: null, idvStatus: null })).toBe(false);
  });
});

describe("awardBlockReasonFromStatus tracks helper_award_block_reason()", () => {
  it("clears a payout-ready helper whose ONLY verdict is idv_status", async () => {
    // The regression this whole file exists for: without the second argument
    // this returns "helper_identity_unverified" for a hirable account.
    await expect(awardBlockReasonFromStatus(PAYOUT_READY, "verified")).resolves.toBeNull();
  });

  it("still blocks a payout-ready helper with neither verdict", async () => {
    await expect(awardBlockReasonFromStatus(PAYOUT_READY, "pending")).resolves.toBe(
      "helper_identity_unverified",
    );
  });

  it("checks payouts BEFORE identity, in the server's order", async () => {
    // A helper missing both must be told about payouts first — that is the
    // order helper_award_block_reason returns, and sending someone into a
    // Stripe Identity flow when they have no payout account at all leaves them
    // blocked after completing it.
    await expect(
      awardBlockReasonFromStatus({ ...PAYOUT_READY, payouts_enabled: false }, null),
    ).resolves.toBe("helper_payout_setup_incomplete");
  });

  it("reports helper_unknown rather than guessing when status is missing", async () => {
    await expect(awardBlockReasonFromStatus(null, "verified")).resolves.toBe("helper_unknown");
  });

  it("honours the operator pause flag, and only via the flag", async () => {
    vi.mocked(isIdvRequirementPaused).mockResolvedValue(true);
    await expect(awardBlockReasonFromStatus(PAYOUT_READY, "pending")).resolves.toBeNull();
  });

  it("omitting idv_status keeps the old, stricter answer", async () => {
    // Callers that genuinely cannot reach the column must not be silently
    // loosened: absence contributes nothing, it does not vote yes.
    await expect(awardBlockReasonFromStatus(PAYOUT_READY)).resolves.toBe(
      "helper_identity_unverified",
    );
  });
});

describe("awardBlockFromError reads the codes the trigger actually raises", () => {
  it.each([
    "helper_payout_setup_incomplete",
    "helper_identity_unverified",
    "helper_unknown",
  ])("recognises %s inside a Postgres error message", (code) => {
    expect(awardBlockFromError({ message: `new row violates: ${code}` })).toBe(code);
  });

  it("returns null for an unrelated failure rather than inventing a block", () => {
    expect(awardBlockFromError({ message: "network request failed" })).toBeNull();
  });
});
