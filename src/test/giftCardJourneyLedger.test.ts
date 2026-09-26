/**
 * GUARD: the gift card journey's ledger checks can fail (SC-005).
 *
 * e2e/prod-gift-card.spec.ts can only run where the shared test accounts
 * exist (GitHub secrets), so a check that silently accepted anything would go
 * unnoticed until the one run that mattered. Every check in
 * e2e/giftCardLedger.ts is fed here a row that is RIGHT (must pass) and rows
 * that are wrong in exactly ONE way (each must be caught), shaped after the
 * writers the checks cite: create-gift-card-checkout's pre-registration, the
 * webhook mint, claim-gift-card, redeem_gift_card's two branches and
 * restore_gift_card_for_job.
 */
import { describe, expect, it } from "vitest";
import {
  checkClaimed,
  checkConsumed,
  checkMinted,
  checkPreRegistered,
  checkReserved,
  checkRestored,
  checkSettled,
  checkShortfall,
  type GiftRow,
} from "../../e2e/giftCardLedger";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const IN_90 = new Date(NOW + 90 * 86_400_000).toISOString();
const DONOR = "donor-1";
const RECIPIENT = "recipient-1";

const row = (over: Partial<GiftRow> = {}): GiftRow => ({
  id: "g0",
  donor_id: DONOR,
  recipient_id: null,
  recipient_email: "poster@example.com",
  amount: 34.56,
  status: "available",
  payment_status: "pending",
  job_id: null,
  claim_token: null,
  stripe_session_id: "cs_test_1",
  stripe_payment_intent_id: null,
  parent_credit_id: null,
  restored_from_job_id: null,
  redeemed_at: null,
  expires_at: IN_90,
  ...over,
});

/** Each wrong row must produce at least one violation; the right one none. */
function eachCaught(check: (r: GiftRow) => string[], right: GiftRow, wrongs: Record<string, Partial<GiftRow>>) {
  expect(check(right)).toEqual([]);
  const survived = Object.entries(wrongs).filter(([, over]) => check({ ...right, ...over }).length === 0);
  expect(survived.map(([name]) => name), "wrong rows the check accepted").toEqual([]);
  // Inventory floor: a check fed no wrong rows proves nothing.
  expect(Object.keys(wrongs).length).toBeGreaterThan(2);
}

describe("gift card journey ledger checks catch a wrong row", () => {
  // @mutate e2e/giftCardLedger.ts | if (row.payment_status !== "pending") | if (false)
  it("pre-registration", () => {
    const e = { donorId: DONOR, recipientEmail: "Poster@Example.com", faceCents: 3456, sessionId: "cs_test_1", now: NOW };
    eachCaught((r) => checkPreRegistered(r, e), row(), {
      "already paid": { payment_status: "paid" },
      "already sent": { status: "sent" },
      "claim token before payment": { claim_token: "a".repeat(64) },
      "wrong face": { amount: 34.55 },
      "wrong donor": { donor_id: "someone" },
      "wrong session": { stripe_session_id: "cs_test_2" },
      "email not lowercased": { recipient_email: "Poster@Example.com" },
      "no expiry": { expires_at: null },
      "30-day expiry": { expires_at: new Date(NOW + 30 * 86_400_000).toISOString() },
    });
  });

  // @mutate e2e/giftCardLedger.ts | if (!/^[0-9a-f]{64}$/.test(row.claim_token ?? "")) | if (false)
  it("webhook mint", () => {
    const minted = row({ status: "sent", payment_status: "paid", claim_token: "0f".repeat(32), stripe_payment_intent_id: "pi_1", recipient_id: RECIPIENT });
    const e = { preRegisteredId: "g0", donorId: DONOR, recipientId: RECIPIENT, faceCents: 3456, now: NOW };
    expect(checkMinted({ ...minted, recipient_id: null }, e), "an unbound mint is legitimate").toEqual([]);
    eachCaught((r) => checkMinted(r, e), minted, {
      "second row inserted": { id: "g-other" },
      "still pending": { payment_status: "pending" },
      "not sent": { status: "available" },
      "short token": { claim_token: "abc" },
      "no PaymentIntent": { stripe_payment_intent_id: null },
      "bound to a stranger": { recipient_id: "stranger" },
      "already redeemed": { job_id: "job-x", redeemed_at: IN_90 },
      "face drifted": { amount: 34 },
    });
  });

  // @mutate e2e/giftCardLedger.ts | if (row.recipient_id !== e.recipientId) out.push | if (false) out.push
  it("claim", () => {
    const claimed = row({ status: "sent", payment_status: "paid", recipient_id: RECIPIENT });
    eachCaught((r) => checkClaimed(r, { recipientId: RECIPIENT, faceCents: 3456 }), claimed, {
      unbound: { recipient_id: null },
      "bound to donor": { recipient_id: DONOR },
      "amount inflated": { amount: 500 },
      "state moved": { status: "redeemed" },
    });
  });

  // @mutate e2e/giftCardLedger.ts | if (cents(c.amount) !== leftover) | if (false)
  it("settled redemption and its leftover", () => {
    const gift = row({ status: "redeemed", payment_status: "paid", recipient_id: RECIPIENT, job_id: "job-a", redeemed_at: IN_90 });
    const child = row({ id: "g1", status: "sent", payment_status: "paid", recipient_id: RECIPIENT, amount: 24.56, parent_credit_id: "g0", stripe_session_id: null });
    const job = { id: "job-a", payment_status: "escrow" };
    const e = { costCents: 1000, recipientId: RECIPIENT };
    expect(checkSettled(gift, [child], job, e)).toEqual([]);
    const caught = {
      "job not funded": checkSettled(gift, [child], { ...job, payment_status: "unpaid" }, e),
      "gift not consumed": checkSettled({ ...gift, status: "sent" }, [child], job, e),
      "gift on another job": checkSettled({ ...gift, job_id: "job-z" }, [child], job, e),
      "no redeemed_at": checkSettled({ ...gift, redeemed_at: null }, [child], job, e),
      "leftover missing": checkSettled(gift, [], job, e),
      "leftover twice": checkSettled(gift, [child, { ...child, id: "g1b" }], job, e),
      "leftover short a cent": checkSettled(gift, [{ ...child, amount: 24.55 }], job, e),
      "leftover to a stranger": checkSettled(gift, [{ ...child, recipient_id: "stranger" }], job, e),
      "leftover unpaid": checkSettled(gift, [{ ...child, payment_status: "pending" }], job, e),
      "leftover with a claim token": checkSettled(gift, [{ ...child, claim_token: "x" }], job, e),
      "exact cover but a leftover exists": checkSettled({ ...gift, amount: 10 }, [child], job, e),
    };
    expect(Object.entries(caught).filter(([, v]) => v.length === 0).map(([k]) => k)).toEqual([]);
  });

  // @mutate e2e/giftCardLedger.ts | if (gift.status !== "reserved") | if (false)
  it("reserved for a shortfall, the shortfall itself, and its consumption", () => {
    const reserved = row({ id: "g1", status: "reserved", payment_status: "paid", recipient_id: RECIPIENT, job_id: "job-b" });
    const unpaid = { id: "job-b", payment_status: "unpaid" };
    expect(checkReserved(reserved, unpaid)).toEqual([]);
    expect(checkReserved({ ...reserved, status: "sent" }, unpaid)).not.toEqual([]);
    expect(checkReserved({ ...reserved, job_id: "job-z" }, unpaid)).not.toEqual([]);
    expect(checkReserved(reserved, { ...unpaid, payment_status: "escrow" })).not.toEqual([]);

    expect(checkShortfall(446, { costCents: 2900, giftCents: 2454 })).toEqual([]);
    expect(checkShortfall(446 + 50, { costCents: 2900, giftCents: 2454 }), "a service fee on a gift job").not.toEqual([]);

    const consumed = { ...reserved, status: "redeemed", redeemed_at: IN_90 };
    const funded = { id: "job-b", payment_status: "escrow" };
    expect(checkConsumed(consumed, funded)).toEqual([]);
    expect(checkConsumed(reserved, funded), "still reserved after payment").not.toEqual([]);
    expect(checkConsumed(consumed, unpaid), "job never funded").not.toEqual([]);
    expect(checkConsumed({ ...consumed, redeemed_at: null }, funded)).not.toEqual([]);
  });

  // @mutate e2e/giftCardLedger.ts | if (restored.length !== 1) return | if (false) return
  it("restore after cancellation", () => {
    const r = row({ id: "g2", status: "sent", payment_status: "paid", recipient_id: RECIPIENT, amount: 10, parent_credit_id: "g0", restored_from_job_id: "job-a", stripe_session_id: null });
    const e = { jobId: "job-a", parentId: "g0", appliedCents: 1000, recipientId: RECIPIENT };
    expect(checkRestored([r], e)).toEqual([]);
    expect(checkRestored([], e), "the gift was lost (the cancel_escrow defect)").not.toEqual([]);
    expect(checkRestored([r, { ...r, id: "g3" }], e), "restored twice").not.toEqual([]);
    eachCaught((x) => checkRestored([x], e), r, {
      "wrong amount": { amount: 34.56 },
      "wrong parent": { parent_credit_id: "g9" },
      "not spendable": { payment_status: "refunded" },
      "to a stranger": { recipient_id: "stranger" },
      "already on a job": { job_id: "job-q" },
    });
  });
});
