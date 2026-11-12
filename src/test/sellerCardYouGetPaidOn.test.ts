/**
 * F360b / F398 / F404 (owner 11-11 ~2:10 PM): every seller order card shows "You get $X, paid on <date>", with the
 * delivery ("You get $50 ($45 + $5 delivery)") and after a part refund ("You get $25 after the $20 refund"), from the
 * payout row's own numbers, and no fee words.
 *
 * The numbers, read from the newest SQL: declutter_complete_handover writes amount = items + v_rate (a seller delivery's
 * rate) - manager share - debt (20261109224952); a refund re-prices it to items + delivery - refunded - share - debt
 * (declutter_rebook_payout, 20261101233256); declutter_payout_take_setup_fee takes the one-time setup fee from the first
 * unsent row at its send, adding it to debt_cents (20261031214749). The money is sent once declutter_sale_final is true:
 * 24 hours after the handover, unless a refund request or problem holds it (declutter_payouts_due, 20261105032500).
 *
 * Before: "Your earnings: $50 ($45 + $5 delivery). We send it once the sale is final: 24 hours after the handover,
 * unless the buyer asks for a refund." (no date), and "Your earnings: $25 after the buyer's refund." (no amount refunded);
 * before the handover "You get $50 ($45 for the sale and $5 for delivering it)".
 *
 * @mutate src/components/declutter/declutterPayoutWords.ts | ends ? `${gets}, paid on ${payoutDayAfterWindow(ends)} unless the buyer asks for a refund.` | ends ? `${gets}. We send it once the sale is final.`
 * lh-money-escrow review (11-11): no ready payout account promises no day; a declined refund moves the day; a fee read
 * not answered yet shows no figure; dates only.
 * @mutate src/components/declutter/declutterPayoutWords.ts | if (ctx.payoutReady === false) return | if (false) return
 * @mutate src/components/declutter/declutterPayoutWords.ts | const from = ctx.declinedAt && | const from = false &&
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | const feeUnknown = setupFee.unknown; | const feeUnknown = false;
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | holdUnknown={feeUnknown \|\| !problemsSettled \|\| | holdUnknown={feeUnknown \|\|
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | !((holdUnknown \|\| (refundRequests && !refund.isSuccess) \|\| lastProblem.isLoading) && | !((holdUnknown \|\| lastProblem.isLoading) &&
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | \|\| lastProblem.isLoading) && (payout.status | ) && (payout.status
 * @mutate src/lib/declutter/timeLeft.ts | return payoutDay(new Date(Date.parse(windowEnds) + PAYOUT_SEND_MARGIN_MS).toISOString()); | return payoutDay(windowEnds);
 * @mutate src/lib/declutter/payoutWords.ts | : ` after the ${formatPrice(refunded)} refund`; | : " after the buyer's refund";
 * @mutate src/components/declutter/declutterPayoutWords.ts | if (could.length === 1) | if (could.length >= 1)
 * @mutate src/components/declutter/declutterPayoutWords.ts | ...(could.length > 1 ? could : []) | ...([] as MyPayout[])
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | \|\| feeUnsure.has(o.orderId)} | }
 * @mutate src/components/declutter/declutterPayoutWords.ts | if (fee <= 0 \|\| payouts.some((p) => (p.setup_fee_cents ?? 0) > 0)) return out; | if (fee <= 0) return out;
 * @mutate src/components/declutter/declutterPayoutWords.ts | const amount = payout.amount_cents - ahead; | const amount = payout.amount_cents;
 * @mutate src/components/declutter/declutterPayoutWords.ts | const parts = addsUp ? payoutBreakdown(payout) : ""; | const parts = payoutBreakdown(payout);
 * @mutate src/components/declutter/declutterPayoutWords.ts | if (ctx.refundOpen) return | if (false) return
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | refundOpen: refundIsOpen(refundStatus), setupFeeAhead, payoutReady, | refundOpen: false, setupFeeAhead: 0, payoutReady,
 * F360b loose ends (lead 11-11): an agreed part refund holds the payout until the buyer's refund went through
 * (declutter_payouts_due: no refund_request_part refund pending/failed), then the sale is decided (declutter_sale_decided:
 * a request 'agreed') and final at once, so no "paid on" day 24 hours out.
 * @mutate src/components/declutter/declutterPayoutWords.ts | if (ctx.refundAgreed && REFUND_HOLDS.has(ctx.refundAgreed)) return | if (false) return
 * @mutate src/components/declutter/declutterPayoutWords.ts |   if (ctx.refundAgreed) return `${gets}. The sale is final, so we send it next.`; |
 * @mutate src/components/declutter/declutterPayoutWords.ts | new Set(["pending", "failed", "held_for_review", "unknown"]) | new Set(["pending", "failed", "unknown", "settled_by_hand"])
 * @mutate src/components/declutter/declutterPayoutWords.ts | new Set(["pending", "failed", "held_for_review", "unknown"]) | new Set(["pending", "failed", "unknown"])
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | refundAgreed: refundStatus === "agreed" ? refund.data?.request?.refund_status ?? "unknown" : null, | refundAgreed: null,
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx | ` (${formatPrice(itemsCents)} + ${formatPrice(deliveryCents)} delivery)` | ` (${formatPrice(itemsCents)} for the sale and ${formatPrice(deliveryCents)} for delivering it)`
 * Owner 11-11 ~3:25 PM: the fee comes out of the FIRST payout actually sent; every card shows it on that sale only. The
 * server names the sale (declutter_my_setup_fee, 20261111212343); the card takes the fee off only there, including the
 * pre-handover "You get".
 * @mutate src/components/declutter/declutterPayoutWords.ts | if (row && (row.status === "pending" \|\| row.status === "failed") && (row.setup_fee_cents ?? 0) === 0) out.set(orderId, fee); | out.set(orderId, fee);
 * @mutate src/components/declutter/declutterPayoutWords.ts | const cut = fee && fee.orderId === orderId ? | const cut = fee ?
 * @mutate src/components/declutter/declutterPayoutWords.ts | return cut > 0 && gross - cut >= 100 ? gross - cut : gross; | return gross - cut;
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | const feeAhead = setupFee.server ? setupFeeAheadFromServer(payouts.data ?? [], setupFee.cents, setupFee.orderId) | const feeAhead = false ? setupFeeAheadFromServer(payouts.data ?? [], setupFee.cents, setupFee.orderId)
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx | preHandover && setupFee.server ? setupFee : null | null
 * F360b loose end (lead 11-11): a problem Louisiana Helpr decided, or a handover an admin confirmed, makes the sale final
 * at once (declutter_sale_decided), so no "paid on" day 24 hours out.
 * @mutate src/components/declutter/declutterPayoutWords.ts |   if (ctx.saleDecided) return `${gets}. The sale is final, so we send it next.`; |
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | const saleDecided = lastProblem.data?.status === "decided" \|\| handoverRow.data?.confirmed_by === "admin"; | const saleDecided = lastProblem.data?.status === "decided";
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | const saleDecided = lastProblem.data?.status === "decided" \|\| | const saleDecided =
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { payoutLine, preHandoverSellerCents, setupFeeAheadByOrder, setupFeeAheadFromServer, setupFeeUnsureOrders } from "@/components/declutter/declutterPayoutWords";
import type { MyPayout } from "@/lib/declutter/payoutReads";
import { payoutDay, payoutDayAfterWindow } from "@/lib/declutter/timeLeft";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const code = (p: string) => blankComments(readFileSync(resolve(REPO, p), "utf8"));
const NOW = Date.parse("2026-11-11T20:00:00Z");
const HANDED = "2026-11-11T18:00:00Z"; // 2 hours ago: the buyer's 24 hours end 2026-11-12T18:00Z
const row = (over: Partial<MyPayout> = {}): MyPayout => ({
  order_id: "o1", items_cents: 4500, delivery_cents: 0, refunded_cents: 0, debt_cents: 0, amount_cents: 4500,
  status: "pending", executed_at: null, attempts: 0, setup_fee_cents: 0, ...over,
});

describe("F360b: the seller card's one money line", () => {
  it("with delivery: You get $50 ($45 + $5 delivery), paid on the day the sale is final", () => {
    const line = payoutLine(row({ delivery_cents: 500, amount_cents: 5000 }), false, { handedOverAt: HANDED, now: NOW });
    expect(line).toBe(`You get $50 ($45 + $5 delivery), paid on ${payoutDay("2026-11-12T18:00:00.000Z")} unless the buyer asks for a refund.`);
  });

  it("after a part refund: You get $25 after the $20 refund", () => {
    const line = payoutLine(row({ refunded_cents: 2000, amount_cents: 2500 }), false, { handedOverAt: HANDED, now: NOW });
    expect(line.startsWith("You get $25 after the $20 refund, paid on ")).toBe(true);
  });

  it("a sent payout says the day it was paid", () => {
    expect(payoutLine(row({ status: "succeeded", executed_at: "2026-11-10T18:31:00Z" }), false)).toBe(`You get $45, paid on ${payoutDay("2026-11-10T18:31:00Z")}.`);
  });

  it("the one-time setup fee: the amount drops, the parts and the fee are never named", () => {
    // Taken already: in debt_cents and out of amount_cents.
    expect(payoutLine(row({ setup_fee_cents: 200, debt_cents: 200, amount_cents: 4300 }), false, { handedOverAt: HANDED, now: NOW }))
      .toMatch(/^You get \$43, paid on /);
    // Still to be taken at the send, from the only row that can take it.
    const rows = [row(), row({ order_id: "o2", status: "succeeded", attempts: 1 })];
    const ahead = setupFeeAheadByOrder(rows, 200);
    expect([...ahead.entries()]).toEqual([["o1", 200]]);
    expect(payoutLine(rows[0], false, { handedOverAt: HANDED, now: NOW, setupFeeAhead: ahead.get("o1") })).toMatch(/^You get \$43, paid on /);
    // Two rows could take it: the client cannot tell which, so neither is lowered, and both show no figure.
    expect(setupFeeAheadByOrder([row(), row({ order_id: "o2" })], 200).size).toBe(0);
    expect([...setupFeeUnsureOrders([row(), row({ order_id: "o2" })], 200)].sort()).toEqual(["o1", "o2"]);
    expect(setupFeeUnsureOrders(rows, 200).size).toBe(0);
    // A try count not readable: unsure too.
    expect([...setupFeeUnsureOrders([row({ attempts: undefined })], 200)]).toEqual(["o1"]);
    // A row already carries the fee (taken at its send): no other row is lowered, even if the cached profile says unpaid.
    expect(setupFeeAheadByOrder([row(), row({ order_id: "o2", status: "succeeded", setup_fee_cents: 200, attempts: 1 })], 200).size).toBe(0);
    // Under $1 left: the SQL leaves the fee for a later sale.
    expect(setupFeeAheadByOrder([row({ amount_cents: 250 })], 200).size).toBe(0);
  });

  it("held by a refund request or a problem, it says so instead of a day; no fee words anywhere", () => {
    const lines = [
      payoutLine(row(), false, { handedOverAt: HANDED, now: NOW, refundOpen: true }),
      payoutLine(row(), true, { handedOverAt: HANDED, now: NOW }),
      payoutLine(row({ delivery_cents: 500, amount_cents: 5000 }), false, { handedOverAt: HANDED, now: NOW }),
      payoutLine(row({ refunded_cents: 2000, amount_cents: 2500 }), false, { handedOverAt: HANDED, now: NOW }),
      payoutLine(row({ setup_fee_cents: 200, debt_cents: 200, amount_cents: 4300 }), false, { handedOverAt: HANDED, now: NOW }),
    ];
    expect(lines[0]).toBe("You get $45. It waits until the refund request is settled.");
    expect(lines[1]).toBe("You get $45. It's held while Louisiana Helpr looks at the problem.");
    expect(lines.length).toBeGreaterThan(4);
    for (const l of lines) expect(l).not.toMatch(/\bfees?\b/i);
  });

  it("no ready payout account: no day; a declined refund request moves the day to its own 24 hours", () => {
    expect(payoutLine(row(), false, { handedOverAt: HANDED, now: NOW, payoutReady: false, setupPaused: false })).toBe("You get $45 once you set up payouts in Settings.");
    // While payout setup is not offered (usePayoutSetupPaused), the line never sends the seller to set it up.
    expect(payoutLine(row(), false, { handedOverAt: HANDED, now: NOW, payoutReady: false, setupPaused: true })).toBe("You get $45 once your payout account is ready.");
    expect(payoutLine(row(), false, { handedOverAt: HANDED, now: NOW, payoutReady: false })).toBe("You get $45 once your payout account is ready.");
    const declined = "2026-11-11T19:30:00Z"; // after the handover: final at 2026-11-12T19:30Z
    expect(payoutLine(row(), false, { handedOverAt: HANDED, now: NOW, declinedAt: declined }))
      .toBe(`You get $45, paid on ${payoutDay("2026-11-12T19:30:00.000Z")} unless the buyer asks Louisiana Helpr to look.`);
    // Past the handover's 24 hours but inside the decline's: still a day, never "we send it next".
    const later = Date.parse("2026-11-12T18:30:00Z");
    expect(payoutLine(row(), false, { handedOverAt: HANDED, now: later, declinedAt: declined })).toMatch(/, paid on /);
    expect(payoutLine(row(), false, { handedOverAt: HANDED, now: later })).toBe("You get $45. The sale is final, so we send it next.");
    // A window ending 11:55 PM Central pays after the 10-minute margin: the next day (declutter_sale_final).
    expect(payoutDayAfterWindow("2026-11-13T05:55:00Z")).toBe(payoutDay("2026-11-13T06:05:00Z"));
    expect(payoutDayAfterWindow("2026-11-13T05:55:00Z")).not.toBe(payoutDay("2026-11-13T05:55:00Z"));
    // The day is a date, never a minute.
    expect(payoutLine(row(), false, { handedOverAt: HANDED, now: NOW })).not.toMatch(/\d:\d\d/);
  });

  it("an agreed part refund: on hold until the buyer's refund goes through, then sent next (no day 24 hours out)", () => {
    const part = row({ refunded_cents: 2000, amount_cents: 2500 });
    // Money review 11-11 (20261111211749): a part refund held for review holds the payout too.
    for (const st of ["pending", "failed", "held_for_review", "unknown"] as const) {
      expect(payoutLine(part, false, { handedOverAt: HANDED, now: NOW, refundAgreed: st })).toBe("You get $25 after the $20 refund. It's on hold until the buyer's refund goes through.");
    }
    // Not held by the run (lh-money-escrow review 11-11): sent next.
    for (const st of ["succeeded", "settled_by_hand"] as const) {
      expect(payoutLine(part, false, { handedOverAt: HANDED, now: NOW, refundAgreed: st })).toBe("You get $25 after the $20 refund. The sale is final, so we send it next.");
    }
    // No payout account still says so first; a sent payout still says its day.
    expect(payoutLine(part, false, { handedOverAt: HANDED, now: NOW, refundAgreed: "succeeded", payoutReady: false, setupPaused: false })).toBe("You get $25 after the $20 refund once you set up payouts in Settings.");
    expect(payoutLine({ ...part, status: "succeeded", executed_at: HANDED }, false, { refundAgreed: "pending" })).toMatch(/, paid on /);
  });

  it("the card passes the handover time, the refund state and the setup fee; the open sale uses the same parts", () => {
    const views = code("src/components/declutter/DeclutterHandoverViews.tsx");
    expect(views).toMatch(/payoutLine\(payout, !!problem, \{\s*handedOverAt: handoverRow\.data\?\.confirmed_at \?\? null, refundOpen: refundIsOpen\(refundStatus\), setupFeeAhead, payoutReady, setupPaused,\s*declinedAt: refundStatus === "declined" \? refund\.data\?\.request\?\.declined_at \?\? null : null,\s*refundAgreed: refundStatus === "agreed" \? refund\.data\?\.request\?\.refund_status \?\? "unknown" : null, saleDecided, \}\)/);
    // A hold read not answered yet (fee inputs, open problems, the refund request): unsent rows show no line rather than
    // a figure too high by the fee or a day the server will not keep (lh-money-escrow re-review 11-11).
    expect(views).toContain("const feeUnknown = setupFee.unknown;");
    expect(views).toContain("holdUnknown={feeUnknown || !problemsSettled || feeUnsure.has(o.orderId)}");
    expect(views).toMatch(/!\(\(holdUnknown \|\| \(refundRequests && !refund\.isSuccess\) \|\| lastProblem\.isLoading\) && \(payout\.status === "pending" \|\| payout\.status === "failed"\)\) && <p/);
    expect(views).toMatch(/setupFeeAhead=\{feeAhead\.get\(o\.orderId\) \?\? 0\}/);
    expect(code("src/components/declutter/DeclutterPorchHandover.tsx")).toContain("` (${formatPrice(itemsCents)} + ${formatPrice(deliveryCents)} delivery)`");
  });

  it("owner 11-11 ~3:25 PM: the fee shows only on the sale the server names, before and after the handover", () => {
    const rows = [row(), row({ order_id: "o2" })];
    // Two unsent rows: the server names o2, so only o2 loses it (the client alone could not tell, and hid both).
    const ahead = setupFeeAheadFromServer(rows, 200, "o2");
    expect([...ahead]).toEqual([["o2", 200]]);
    expect(payoutLine(rows[1], false, { handedOverAt: HANDED, now: NOW, setupFeeAhead: ahead.get("o2") })).toMatch(/^You get \$43, paid on /);
    expect(payoutLine(rows[0], false, { handedOverAt: HANDED, now: NOW, setupFeeAhead: ahead.get("o1") ?? 0 })).toMatch(/^You get \$45, paid on /);
    // No sale named, no fee, or the named row already took it / was sent: nothing comes off any card.
    expect(setupFeeAheadFromServer(rows, 200, null).size).toBe(0);
    expect(setupFeeAheadFromServer(rows, 0, "o2").size).toBe(0);
    expect(setupFeeAheadFromServer([row({ order_id: "o2", setup_fee_cents: 200, amount_cents: 4300 })], 200, "o2").size).toBe(0);
    expect(setupFeeAheadFromServer([row({ order_id: "o2", status: "succeeded" })], 200, "o2").size).toBe(0);
    // Before the handover (no payout row): "You get" less the fee only on the named sale, and only with $1 left.
    expect(preHandoverSellerCents("o1", 4500, 500, { cents: 200, orderId: "o1" })).toBe(4800);
    expect(preHandoverSellerCents("o1", 4500, 500, { cents: 200, orderId: "o2" })).toBe(5000);
    expect(preHandoverSellerCents("o1", 4500, 0, null)).toBe(4500);
    expect(preHandoverSellerCents("o1", 250, 0, { cents: 200, orderId: "o1" })).toBe(250);
    // The card and the note use the server's answer.
    expect(code("src/components/declutter/DeclutterHandoverViews.tsx")).toContain("const feeAhead = setupFee.server ? setupFeeAheadFromServer(payouts.data ?? [], setupFee.cents, setupFee.orderId)");
    expect(code("src/components/declutter/DeclutterPorchHandover.tsx")).toContain("preHandoverSellerCents(orderId, itemsCents, deliveryCents, preHandover && setupFee.server ? setupFee : null)");
  });

  it("lead 11-11: a decided problem or an admin-confirmed handover is final at once: sent next, no day 24 hours out", () => {
    const p = row();
    expect(payoutLine(p, false, { handedOverAt: HANDED, now: NOW, saleDecided: true })).toBe("You get $45. The sale is final, so we send it next.");
    expect(payoutLine(p, false, { handedOverAt: HANDED, now: NOW, saleDecided: false })).toMatch(/^You get \$45, paid on /);
    // Holds still come first: no payout account, an open problem, a sent payout's own day.
    expect(payoutLine(p, false, { handedOverAt: HANDED, now: NOW, saleDecided: true, payoutReady: false, setupPaused: false })).toBe("You get $45 once you set up payouts in Settings.");
    expect(payoutLine(p, true, { handedOverAt: HANDED, now: NOW, saleDecided: true })).toMatch(/held while Louisiana Helpr looks/);
    expect(payoutLine({ ...p, status: "succeeded", executed_at: HANDED }, false, { saleDecided: true })).toMatch(/, paid on /);
    // The card reads both: the last problem (the decided-problem panel's own key) and the handover's confirmed_by.
    const views = code("src/components/declutter/DeclutterHandoverViews.tsx");
    expect(views).toContain('const saleDecided = lastProblem.data?.status === "decided" || handoverRow.data?.confirmed_by === "admin";');
    expect(views).toMatch(/queryKey: \["declutter", "problem", order\.orderId\], queryFn: \(\) => fetchOrderProblem\(order\.orderId\)/);
    expect(views).toMatch(/refundAgreed: refundStatus === "agreed" \? refund\.data\?\.request\?\.refund_status \?\? "unknown" : null, saleDecided, \}\)/);
  });
});
