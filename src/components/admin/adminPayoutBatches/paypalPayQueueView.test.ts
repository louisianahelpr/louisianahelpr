/**
 * The admin "Pay this Helpr" list groups what the owner actually does: ONE PayPal Send Money per Helpr
 * and PayPal account, with the lines' total (PayPal Plan A, phase 4). A wrong group or total is money:
 * Mark paid refuses any total but the lines' own, and a mixed group would send one person another's pay.
 *
 * @mutate src/components/admin/adminPayoutBatches/paypalPayQueueView.ts |     const key = `${l.helper_id ?? "none"}\|${l.destination_value ?? ""}\|${l.env}`; |     const key = `${l.helper_id ?? "none"}`;
 * @mutate src/components/admin/adminPayoutBatches/paypalPayQueueView.ts |     g.totalCents += l.amount_cents ?? 0; |     g.totalCents = l.amount_cents ?? 0;
 * @mutate src/components/admin/adminPayoutBatches/paypalPayQueueView.ts |     g.needsRecheck \|\|= l.held_reason === "destination_changed_since_hire"; |     g.needsRecheck \|\|= false;
 */
import { describe, expect, it } from "vitest";
import { buildPaypalQueueView, looksLikeTxnId, normaliseTxnId, type PaypalQueueLine } from "./paypalPayQueueView";

const line = (o: Partial<PaypalQueueLine>): PaypalQueueLine => ({
  row_kind: "payout", line_kind: "job", payout_id: "p", status: "pending", job_id: "j", job_title: "Job",
  helper_id: "h1", helper_name: "Hal", destination_kind: "paypal_email", destination_value: "hal@example.com",
  current_destination: "hal@example.com", amount_cents: 0, env: "sandbox", pay_on_or_after: null, queued_at: null,
  external_txn_id: null, marked_paid_at: null, marked_paid_by_name: null, pay_blocked: null, held_reason: null,
  tip_id: null, ...o,
});

describe("Pay this Helpr list grouping", () => {
  const view = buildPaypalQueueView([
    line({ payout_id: "a", amount_cents: 9400 }),
    line({ payout_id: "b", line_kind: "tip", tip_id: "t1", amount_cents: 500 }),
    line({ payout_id: "c", helper_id: "h2", helper_name: "Marie", destination_value: "m@example.com", amount_cents: 5800, pay_blocked: "job_hold" }),
    // Same Helpr, a DIFFERENT PayPal account: never the same Send Money.
    line({ payout_id: "d", destination_value: "hal.other@example.com", amount_cents: 100 }),
    line({ payout_id: "e", status: "held", held_reason: "destination_changed_since_hire", amount_cents: 300 }),
    line({ payout_id: "g", status: "held", line_kind: "tip", tip_id: "t3", helper_id: "h3", helper_name: "Hope", destination_value: "hope@example.com", held_reason: "payout_hold", amount_cents: 200 }),
    line({ payout_id: "f", status: "success", external_txn_id: "X", marked_paid_at: "2026-10-20T00:00:00Z" }),
    line({ row_kind: "not_queued", payout_id: null, status: "no_payable_paypal_account" }),
    line({ row_kind: "tip_not_queued", payout_id: null, line_kind: "tip", tip_id: "t2", status: "no_payable_paypal_account", amount_cents: 700 }),
  ]);

  it("reads a real set (floor)", () => {
    expect(view.toSend.length + view.held.length + view.notQueued.length + view.tipsOwed.length + view.paid.length).toBeGreaterThan(5);
  });

  it("one group per Helpr AND PayPal account, with the lines' total; job pay before tips", () => {
    const byKey = Object.fromEntries(view.toSend.map((g) => [`${g.helperName}|${g.destination}`, g]));
    expect(Object.keys(byKey).sort()).toEqual(["Hal|hal.other@example.com", "Hal|hal@example.com", "Marie|m@example.com"]);
    expect(byKey["Hal|hal@example.com"].totalCents).toBe(9900);
    expect(byKey["Hal|hal@example.com"].lines.map((l) => l.line_kind)).toEqual(["job", "tip"]);
    expect(byKey["Marie|m@example.com"].payBlocked).toBe("job_hold");
  });

  it("held, not-queued, tips owed and paid each have their own list", () => {
    expect(view.held).toHaveLength(2);
    const byName = Object.fromEntries(view.held.map((g) => [g.helperName, g]));
    expect(byName.Hal.needsRecheck).toBe(true);
    expect(byName.Hope.heldForPayoutHold).toBe(true);
    expect(byName.Hope.needsRecheck).toBe(false);
    expect(view.notQueued).toHaveLength(1);
    expect(view.tipsOwed.map((l) => l.tip_id)).toEqual(["t2"]);
    expect(view.paid.map((l) => l.payout_id)).toEqual(["f"]);
  });

  it("the transaction id is normalised and checked the way the server does", () => {
    expect(normaliseTxnId(" 9ab12345cd678901e ")).toBe("9AB12345CD678901E");
    expect(looksLikeTxnId("9ab12345cd678901e")).toBe(true);
    expect(looksLikeTxnId("paid!")).toBe(false);
    expect(looksLikeTxnId("")).toBe(false);
  });
});
