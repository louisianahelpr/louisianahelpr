/**
 * A gift card must never offer an action the server is going to refuse, and the
 * donor must be shown the amount they are actually charged.
 *
 * Two defect classes, both audited 2026-09-22 on a feature that had never run in
 * production (`gift_cards` held 0 rows).
 *
 * (1) THE SPEND GATE. `redeem_gift_card` enforces FOUR conditions — not expired,
 *     `payment_status = 'paid'`, `recipient_id = caller`, and a spendable
 *     `status`. `CreditCard` checked only two of them (expiry and status). The
 *     reachable case was the UNCLAIMED gift: the webhook binds `recipient_id`
 *     only when the recipient's email already matches a CONFIRMED profile, RLS
 *     still shows the row by email, and the dashboard teaser counts it — so the
 *     card rendered "Ready to use" with a live button, the user filled in the
 *     whole post-a-job form, and checkout then said the gift "may already be
 *     used, expired, or sent to a different account". None of that was true; it
 *     simply had not been claimed, and no claim affordance existed anywhere in
 *     the UI.
 *
 * (2) THE DONOR TOTAL. The screen showed face value under a hand-typed
 *     "card-processing fee (2.9% + 30¢)". With feePercent 0 the real fee is
 *     Stripe's cost GROSSED UP by /(1 - 2.9%), because the fee is itself part of
 *     the charge Stripe takes its cut of. The copy understated the charge in the
 *     platform's favour at every amount, and no in-app total existed at all.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { CreditCard } from "./CreditCard";
import { StatusPill } from "./StatusPill";
import type { GiftCardRow } from "./types";
import { posterServiceFeeCents } from "@/lib/posterFees";
import { STRIPE_PCT, STRIPE_FLAT_CENTS } from "@/lib/stripeFees";

const ME = "user-me";

function gift(over: Partial<GiftCardRow> = {}): GiftCardRow {
  return {
    id: "gc-1",
    donor_id: "donor-1",
    recipient_id: ME,
    recipient_email: "me@example.com",
    amount: 50,
    status: "sent",
    payment_status: "paid",
    message: null,
    category: null,
    parish: null,
    claim_token: "tok-abc",
    job_id: null,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    created_at: new Date().toISOString(),
    redeemed_at: null,
    ...over,
  };
}

function renderCard(over: Partial<GiftCardRow> = {}, props: Record<string, unknown> = {}) {
  return render(
    <CreditCard
      credit={gift(over)}
      currentUserId={ME}
      onRedeem={vi.fn()}
      onClaim={vi.fn()}
      {...props}
    />,
  );
}

const useBtn = () => screen.queryByRole("button", { name: /use this gift/i });
const claimBtn = () => screen.queryByRole("button", { name: /claim this gift/i });

describe("CreditCard only offers what redeem_gift_card will accept", () => {
  it("offers Use This Gift on a funded, claimed, live gift", () => {
    renderCard();
    expect(useBtn()).not.toBeNull();
  });

  it("does NOT offer it when the donation was refunded or charged back", () => {
    // revoke_gift_card_for_refund sets payment_status='refunded' and
    // deliberately leaves `status` alone, so this is exactly what a revoked
    // gift looks like on the client.
    renderCard({ payment_status: "refunded" });
    expect(useBtn()).toBeNull();
  });

  it("does NOT offer it when the gift is not funded yet", () => {
    renderCard({ payment_status: "pending" });
    expect(useBtn()).toBeNull();
  });

  it("does NOT offer it when the row belongs to someone else", () => {
    // Reachable via the RLS email clause after an email change or a shared
    // address; redeem_gift_card raises 42501 for this.
    renderCard({ recipient_id: "somebody-else" });
    expect(useBtn()).toBeNull();
  });

  it("offers CLAIM, not Use, for a gift that reached me by email but was never bound", () => {
    renderCard({ recipient_id: null });
    expect(useBtn()).toBeNull();
    expect(claimBtn()).not.toBeNull();
  });

  it("never tells the DONOR to claim a gift they sent to someone else", () => {
    render(
      <CreditCard credit={gift({ recipient_id: null })} perspective="sent" currentUserId="donor-1" />,
    );
    expect(claimBtn()).toBeNull();
    expect(screen.queryByText(/^claim it$/i)).toBeNull();
  });

  it("does not offer claim on an expired gift", () => {
    renderCard({
      recipient_id: null,
      expires_at: new Date(Date.now() - 86_400_000).toISOString(),
    });
    expect(claimBtn()).toBeNull();
    expect(useBtn()).toBeNull();
  });
});

describe("StatusPill never flatters an unknown state", () => {
  it("does not render an unrecognised status as Available", () => {
    // The old fallback was `map[status] ?? map.available` — the most permissive
    // label in the set, on a stored-value instrument.
    render(<StatusPill status="some_status_added_later" />);
    // Anchored: "Unavailable" contains "available", so an unanchored match
    // would pass on BOTH the fix and the bug.
    expect(screen.queryByText(/^available$/i)).toBeNull();
    expect(screen.getByText(/^unavailable$/i)).toBeTruthy();
  });

  it("has a label for the derived refunded state", () => {
    render(<StatusPill status="refunded" />);
    expect(screen.getByText(/refunded/i)).toBeTruthy();
  });
});

describe("the donor total is the grossed-up charge, not the hand-typed formula", () => {
  // The sentence that used to be on screen, as a number.
  const naiveFee = (cents: number) => Math.round(cents * STRIPE_PCT) + STRIPE_FLAT_CENTS;

  it("charges more than the old copy promised, at every offered amount", () => {
    for (const dollars of [10, 25, 50, 75, 100, 500]) {
      const cents = dollars * 100;
      const real = posterServiceFeeCents(cents, 0);
      expect(real).toBeGreaterThan(naiveFee(cents));
    }
  });

  it("covers Stripe's cost on the WHOLE charge including the fee itself", () => {
    // The invariant the gross-up exists for: fee >= stripeCost(face + fee).
    // A plain `2.9% + 30c` fee fails this and the platform eats the difference.
    for (const dollars of [10, 25, 50, 75, 100, 500]) {
      const cents = dollars * 100;
      const fee = posterServiceFeeCents(cents, 0);
      const stripeTakes = Math.round((cents + fee) * STRIPE_PCT) + STRIPE_FLAT_CENTS;
      expect(fee).toBeGreaterThanOrEqual(stripeTakes);
    }
  });

  it("pins the published figures the audit reported", () => {
    expect(posterServiceFeeCents(1000, 0)).toBe(61); // $10 gift -> $10.61
    expect(posterServiceFeeCents(5000, 0)).toBe(181); // $50 gift -> $51.81
    expect(posterServiceFeeCents(50000, 0)).toBe(1525); // $500 gift -> $515.25
  });
});

// Each directive must kill this guard on its own.
//
// 1: drop the funding condition from the spend gate — the pre-fix code, which
//    offered "Use This Gift" on a charged-back donation.
// 2: drop the ownership condition — the pre-fix code, which walked an unclaimed
//    recipient into a checkout-time refusal with the wrong reason.
// 3: restore StatusPill's fail-open, which rendered any unknown status as the
//    most permissive label in the set.
// @mutate src/pages/profile/giftCards/CreditCard.tsx | const redeemable = !isExpired && isFunded && isMine && spendableStatus; | const redeemable = !isExpired && isMine && spendableStatus;
// @mutate src/pages/profile/giftCards/CreditCard.tsx | const redeemable = !isExpired && isFunded && isMine && spendableStatus; | const redeemable = !isExpired && isFunded && spendableStatus;
// @mutate src/pages/profile/giftCards/StatusPill.tsx | const s = MAP[status] ?? UNKNOWN; | const s = MAP[status] ?? MAP.available;
// @mutate src/pages/profile/giftCards/CreditCard.tsx | perspective === "received" &&\n    !isExpired && isFunded | !isExpired && isFunded
