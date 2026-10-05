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

// Seen live 2026-10-05: payouts on, Stripe ID needing only an eventually_due
// ssn_last_4. The button asked Stripe for currently_due (nothing), Stripe said
// done, and the Helpr came back still blocked. The ID step must collect
// eventually_due, the only bucket that can clear it.
describe("the ID step's button can actually clear the ID gate", () => {
  it("the blocked ID dialog collects eventually_due", async () => {
    const { awardBlockCopy } = await import("./awardGate");
    expect(awardBlockCopy("helper_identity_unverified").collect).toBe("eventually_due");
  });
  it("the pending-accept dialog collects eventually_due whenever the ID step is missing", async () => {
    const { acceptPendingCopy } = await import("./awardGate");
    expect(acceptPendingCopy(["stripe_id"]).collect).toBe("eventually_due");
    expect(acceptPendingCopy(["payout_setup", "stripe_id"]).collect).toBe("eventually_due");
    expect(acceptPendingCopy(["payout_setup"]).collect).toBe("eventually_due");
  });
});

// Owner, 2026-10-05: Stripe setup collects everything up front (SSN last 4
// included), on every link the server builds.
describe("every Stripe setup link collects everything up front", () => {
  it("stripe-connect's only collection option is eventually_due with future requirements", async () => {
    const { readFileSync } = await import("node:fs");
    const { blankComments } = await import("@/test/helpers/blankNonCode");
    const src = blankComments(readFileSync("supabase/functions/stripe-connect/index.ts", "utf8"));
    expect(src.match(/accountLinks\.create\(/g)?.length ?? 0).toBeGreaterThan(2);
    expect(src).not.toMatch(/fields:\s*"currently_due"/);
    const links = src.split("accountLinks.create(").slice(1).map((b) => b.slice(0, 400));
    expect(links.length).toBeGreaterThan(2);
    for (const b of links) expect(b).toMatch(/collection_options:\s*collectionOptions\(/);
    expect(src).toMatch(/fields: "eventually_due" as const, future_requirements: "include" as const/);
  });
  it("every client copy asks for eventually_due", async () => {
    const { awardBlockCopy } = await import("./awardGate");
    for (const r of ["helper_payout_setup_incomplete", "helper_identity_unverified", "helper_unknown"] as const) {
      expect(awardBlockCopy(r).collect).toBe("eventually_due");
    }
  });
});
// @mutate supabase/functions/stripe-connect/index.ts | ({ fields: "eventually_due" as const, future_requirements: "include" as const }) | ({ fields: "currently_due" as const, future_requirements: "omit" as const })
