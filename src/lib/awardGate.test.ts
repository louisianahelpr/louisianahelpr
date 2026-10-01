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
// The server's rule since migration 20260907013734 was EITHER verdict. Since
// 2026-10-01 identity gates nothing at all (migration
// 20261001222911_remove_idv_requirement); isIdentityVerified survives only to
// draw the verified badge, and these tests pin that display predicate plus the
// payout-only award gate.
import { describe, it, expect } from "vitest";
import {
  isIdentityVerified,
  awardBlockReasonFromStatus,
  awardBlockFromError,
  type AwardGateStatus,
} from "./awardGate";
/** Payout-ready in every respect. */
const PAYOUT_READY: AwardGateStatus = {
  connected: true,
  details_submitted: true,
  payouts_enabled: true,
};

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
  // Since 2026-10-01 (migration 20261001222911_remove_idv_requirement) the
  // server refuses an award for payouts only; identity verification gates
  // nothing (owner: "Remove finish verifying id we don't do that anymore").
  it("clears a payout-ready helper whatever their identity state", async () => {
    await expect(awardBlockReasonFromStatus(PAYOUT_READY)).resolves.toBeNull();
    await expect(
      awardBlockReasonFromStatus({ ...PAYOUT_READY, identity_verified: false } as AwardGateStatus),
    ).resolves.toBeNull();
  });

  it("still blocks a helper whose payouts are not set up", async () => {
    await expect(
      awardBlockReasonFromStatus({ ...PAYOUT_READY, payouts_enabled: false }),
    ).resolves.toBe("helper_payout_setup_incomplete");
    await expect(
      awardBlockReasonFromStatus({ ...PAYOUT_READY, connected: false }),
    ).resolves.toBe("helper_payout_setup_incomplete");
  });

  it("reports helper_unknown rather than guessing when status is missing", async () => {
    await expect(awardBlockReasonFromStatus(null)).resolves.toBe("helper_unknown");
  });
});

describe("awardBlockFromError reads the codes the trigger actually raises", () => {
  it.each([
    "helper_payout_setup_incomplete",
    "helper_unknown",
  ])("recognises %s inside a Postgres error message", (code) => {
    expect(awardBlockFromError({ message: `new row violates: ${code}` })).toBe(code);
  });

  it("returns null for an unrelated failure rather than inventing a block", () => {
    expect(awardBlockFromError({ message: "network request failed" })).toBeNull();
  });
});

// The display verdict accepts EITHER source; the award gate is payout-only.
// @mutate src/lib/awardGate.ts | return source.connectIdentityVerified === true \|\| source.idvStatus === "verified"; | return source.connectIdentityVerified === true;
// @mutate src/lib/awardGate.ts | if (!status.connected \|\| !status.details_submitted \|\| status.payouts_enabled !== true) { | if (false) {
