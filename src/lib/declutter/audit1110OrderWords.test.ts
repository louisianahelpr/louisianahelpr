/**
 * Audit 11-10 (whole-app audit, Worker 4), the order words that are pure rules:
 *  - F392 (High): a finished sale's money line read "$50. undefined": declutter_payouts.status has two values
 *    (held_for_review, settled_by_hand) the words table did not know. Every status the table's CHECK allows now reads
 *    as words, and the line is labelled.
 *  - F365 / F375: a handed-over order inside the buyer's 24 hours says until when they can report a problem, and is
 *    filed under Needs you, not Done.
 *
 * @mutate src/lib/declutter/payoutWords.ts |   held_for_review: "On hold while Louisiana Helpr checks this payout. If it doesn't arrive soon, message Support.", |
 * @mutate src/lib/declutter/payoutWords.ts | return PAYOUT_WORDS[p.status] ?? PAYOUT_UNKNOWN; | return PAYOUT_WORDS[p.status];
 * @mutate src/components/declutter/OrderSteps.tsx |   if (f.done) return f.checkOpen ? "needs_you" : "done"; |   if (f.done) return "done";
 */
import { readFileSync, readdirSync } from "node:fs";
import { blankSqlComments } from "@/test/helpers/blankNonCode";
import { describe, expect, it } from "vitest";
import { payoutStatusWords } from "./payoutWords";
import { payoutLine } from "@/components/declutter/declutterPayoutWords";
import { checkWindowEnds, orderWhen } from "./timeLeft";
import { buyerNextStep } from "@/components/declutter/BuyingOrders";
import { orderBucket, type OrderFacts } from "@/components/declutter/OrderSteps";
import type { MyPayout } from "./payoutReads";

const row = (over: Partial<MyPayout> = {}): MyPayout => ({
  order_id: "o1", items_cents: 5000, delivery_cents: 0, refunded_cents: 0, debt_cents: 0, amount_cents: 5000,
  status: "pending", executed_at: null, attempts: 0, ...over,
});

/** The statuses the NEWEST declutter_payouts status CHECK allows. */
function checkedStatuses(): string[] {
  const dir = "supabase/migrations";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let last: string[] = [];
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(`${dir}/${f}`, "utf8"));
    const re = /ALTER TABLE public\.declutter_payouts ADD CONSTRAINT declutter_payouts_status_check\s+CHECK \(status IN \(([^)]*)\)\)/g;
    for (const m of sql.matchAll(re)) last = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  }
  return last;
}

describe("F392: the seller's payout line", () => {
  it("every status the table allows reads as words, never undefined", () => {
    const statuses = checkedStatuses();
    expect(statuses.length).toBeGreaterThan(5);
    for (const status of statuses) {
      const line = payoutLine(row({ status: status as MyPayout["status"], executed_at: "2026-11-09T18:31:00Z" }), false);
      expect(line, status).not.toMatch(/undefined|null/);
      expect(line, status).toMatch(/^(You get \$50(\.00)?[.,] \S|Nothing to pay out)/);
    }
  });

  it("held and paid-by-hand payouts say where they stand; a sent one says when", () => {
    expect(payoutStatusWords(row({ status: "held_for_review" }))).toMatch(/^On hold while Louisiana Helpr checks this payout/);
    expect(payoutStatusWords(row({ status: "settled_by_hand" }))).toBe("Paid to you by Louisiana Helpr.");
    expect(payoutLine(row({ status: "succeeded", executed_at: "2026-11-09T18:31:00Z" }), false)).toBe("You get $50, paid on Mon, Nov 9.");
    expect(payoutStatusWords(row({ status: "brand_new" as MyPayout["status"] }))).toMatch(/message Support/);
  });
});

describe("F365 / F375: the buyer's 24 hours to check it", () => {
  const now = Date.parse("2026-11-10T21:00:00Z");
  it("ends 24 hours after the handover, and is null once over", () => {
    expect(checkWindowEnds("2026-11-10T20:00:00Z", now)).toBe("2026-11-11T20:00:00.000Z");
    expect(checkWindowEnds("2026-11-09T20:00:00Z", now)).toBeNull();
    expect(checkWindowEnds(null, now)).toBeNull();
    expect(orderWhen("2026-11-11T20:00:00.000Z")).toBe("Wed, Nov 11, 2:00 PM");
  });

  it("the row says until when, and the order is not Done while it runs", () => {
    const f: OrderFacts = { handover: "pickup_home", side: "buyer", booked: true, pickedUp: true, done: true, checkOpen: true };
    expect(buyerNextStep(f, null, null, null, null, undefined, null, "2026-11-11T20:00:00.000Z").text)
      .toBe("You have it. Check it over: you can report a problem until Wed, Nov 11, 2:00 PM, then the sale is final.");
    expect(orderBucket(f)).toBe("needs_you");
    expect(orderBucket({ ...f, checkOpen: false })).toBe("done");
    expect(buyerNextStep({ ...f, checkOpen: false }, null).text).toBe("Handed over. It's yours.");
  });
});
