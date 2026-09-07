// A member must be able to find out that they need an ID check, and how.
//
// Before 2026-09-06 they could not. External QA clicked through Profile,
// Account Security and every settings row and found no verification surface at
// all — the only ID prompt in the product was mounted inside PostJob. Meanwhile
// the `jobs` INSERT policy required `idv_status = 'verified'` to post, and
// `helper_award_block_reason()` required an identity verdict to be hired. Both
// refusals, no invitation.
//
// These tests pin the two properties that make the new slot honest:
//   * it appears for exactly the states that are actually blocked, and
//   * the setup fee is named in the copy BEFORE the member taps anything,
//     rather than arriving as a 402 from `stripe-idv-start` afterwards.
import { describe, it, expect } from "vitest";
import { verificationPromptFor, verificationPromptCopy } from "./verificationPrompt";
import type { Profile } from "./types";

/**
 * A profile with only the columns this module reads. Cast rather than
 * hand-built in full: `profiles` has ~90 columns and none of the others can
 * change the answer — if one ever does, this cast is where the compiler stops
 * being able to help, so keep the factory to the real predicate inputs.
 */
function profile(over: Partial<Profile>): Profile {
  return {
    idv_status: "not_started",
    onboarding_fee_paid: false,
    stripe_identity_verified: false,
    idv_failure_reason: null,
    ...over,
  } as Profile;
}

describe("the slot appears exactly when the member is actually blocked", () => {
  it("is silent for a verified member — no trophy row on a settings screen", () => {
    expect(verificationPromptFor(profile({ idv_status: "verified" })).kind).toBe("none");
  });

  it("is silent when there is no profile — absence is not a claim", () => {
    // Telling someone they are unverified because their profile has not loaded
    // is the same class of bug as the payout banner that showed on a failed
    // status check.
    expect(verificationPromptFor(null).kind).toBe("none");
  });

  it("STILL prompts a member whose only verdict is the Connect flag", () => {
    // This is the asymmetry that makes `idv_status` the right predicate here.
    // `helper_award_block_reason` accepts `stripe_identity_verified`, so this
    // person CAN be hired — but the jobs INSERT policy accepts only
    // `idv_status`, so they cannot post, and a silent slot would leave them
    // refused at Post Job with nothing to act on.
    const p = verificationPromptFor(
      profile({ idv_status: "not_started", stripe_identity_verified: true }),
    );
    expect(p.kind).toBe("start");
    expect(p).toMatchObject({ hireOnlyCleared: true });
  });

  it.each([
    ["manual_review", "manual_review"],
    ["failed", "manual_review"],
    ["processing", "in_progress"],
  ])("maps idv_status %s to the %s state", (status, kind) => {
    expect(verificationPromptFor(profile({ idv_status: status })).kind).toBe(kind);
  });

  it("treats 'pending' as resumable, not as 'Stripe is thinking'", () => {
    // `claim_idv_attempt` writes 'pending' the moment it hands out the one paid
    // attempt, so 'pending' means a session is waiting for photos. Showing
    // "we'll notify you" there strands someone who has to go and finish it.
    expect(verificationPromptFor(profile({ idv_status: "pending" }))).toMatchObject({
      kind: "start",
      resuming: true,
    });
  });
});

describe("the setup fee is disclosed before the tap, not after the 402", () => {
  it("names the fee amount when it is owed", () => {
    const copy = verificationPromptCopy(
      verificationPromptFor(profile({ onboarding_fee_paid: false })),
      "$2",
    );
    expect(copy?.body).toContain("$2");
    expect(copy?.body).toMatch(/one-time/i);
  });

  it("does not mention a fee once it is paid", () => {
    const copy = verificationPromptCopy(
      verificationPromptFor(profile({ onboarding_fee_paid: true })),
      "$2",
    );
    expect(copy?.body).not.toContain("$2");
  });

  it("reads correctly with no amount rather than inventing one", () => {
    // The fee is `platform_settings.onboarding_fee_cents`, an admin-editable
    // number. A failed lookup must drop the figure, never guess it — quoting a
    // price the platform does not charge is worse than quoting none.
    const copy = verificationPromptCopy(
      verificationPromptFor(profile({ onboarding_fee_paid: false })),
      null,
    );
    expect(copy?.body).not.toMatch(/\$/);
    expect(copy?.body).not.toMatch(/\bnull\b|undefined|\bNaN\b/);
    expect(copy?.body).toMatch(/one-time account setup fee/i);
  });
});

describe("copy tells the truth about what is blocked", () => {
  it("names both consequences for a member blocked on both", () => {
    const copy = verificationPromptCopy(
      verificationPromptFor(profile({ idv_status: "not_started" })),
      "$2",
    );
    expect(copy?.body).toMatch(/post a job or be hired/i);
  });

  it("claims only the posting block when the hire gate is already cleared", () => {
    const copy = verificationPromptCopy(
      verificationPromptFor(
        profile({ idv_status: "not_started", stripe_identity_verified: true }),
      ),
      "$2",
    );
    expect(copy?.body).toMatch(/post a job/i);
    expect(copy?.body).not.toMatch(/be hired/i);
  });

  it("offers no action in the states where there is nothing to press", () => {
    // An enabled control that cannot help is the "affordance for an action
    // that will be refused" pattern this codebase keeps re-shipping.
    for (const status of ["processing", "manual_review"]) {
      const copy = verificationPromptCopy(
        verificationPromptFor(profile({ idv_status: status })),
        "$2",
      );
      expect(copy?.action).toBeNull();
    }
  });

  it("offers an action in every state that has one", () => {
    for (const status of ["not_started", "pending", "skipped", null]) {
      const copy = verificationPromptCopy(
        verificationPromptFor(profile({ idv_status: status })),
        "$2",
      );
      expect(copy?.action).toBeTruthy();
    }
  });
});
