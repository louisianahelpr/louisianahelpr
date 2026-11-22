/**
 * CLASS GUARD (deep audit 1122 #5): after a part refund the seller's "You get" is the payout, not the sale.
 *
 * WHAT WAS BROKEN: a handed-over $60 sale with a $20 part refund said "You get $60 once you set up payouts" right
 * above "The buyer got $20 back." The payout the server books is items + delivery - refunded (declutter_rebook_payout),
 * so the seller would really get $40. MoneyNote's handed-over line used preHandoverSellerCents (items + delivery) and
 * only knew about a FULL refund.
 *
 * WHAT THIS PINS
 *   1. The client's handed-over amount (handedOverSellerCents) subtracts the order's agreed refund, the same formula
 *      the newest declutter_rebook_payout books (read from the migrations, not restated).
 *   2. Inventory from source: every handed-over "You get" line (the dsl.getOnceReady / getOnceSetup / getPaidOn /
 *      getWindowOver keys) in src/ takes its amount from handedOverSellerCents and says the refund in its {parts}
 *      ("You get $40 ($60 minus $20 refunded)"), and both languages carry {parts} in each.
 */
// @mutate src/components/declutter/declutterPayoutWords.ts | return Math.max(0, preHandoverSellerCents(itemsCents, deliveryCents) - Math.max(0, refundedCents)); | return preHandoverSellerCents(itemsCents, deliveryCents);
// @mutate src/components/declutter/DeclutterPorchHandover.tsx | const paidCents = handedOverSellerCents(itemsCents, deliveryCents, refundedCents); | const paidCents = sellerCents;
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { agreedRefundCents, handedOverSellerCents } from "@/components/declutter/declutterPayoutWords";
import { enDeclSell } from "@/lib/i18n/enDeclSell";
import { esDeclSell } from "@/lib/i18n/esDeclSell";

const HANDED_OVER_KEYS = ["dsl.getOnceReady", "dsl.getOnceSetup", "dsl.getPaidOn", "dsl.getWindowOver"] as const;

describe("a part refund comes off the seller's handed-over amount (deep audit 1122 #5)", () => {
  it("the audit's order: $60 sale, $20 refunded, the seller gets $40", () => {
    const refunded = agreedRefundCents({ status: "agreed", refund_cents: 2000 });
    expect(refunded).toBe(2000);
    expect(handedOverSellerCents(6000, 0, refunded)).toBe(4000);
    expect(handedOverSellerCents(4500, 500, 1000)).toBe(4000);
    // A request that is not settled takes nothing off; nothing goes below zero.
    expect(agreedRefundCents({ status: "open", refund_cents: 2000 })).toBe(0);
    expect(agreedRefundCents({ status: "agreed", refund_cents: null })).toBe(0);
    expect(agreedRefundCents(null)).toBe(0);
    expect(handedOverSellerCents(1000, 0, 5000)).toBe(0);
  });

  it("matches the payout the server books (newest declutter_rebook_payout)", () => {
    const defs = effectiveDefs(join(process.cwd(), "supabase", "migrations"));
    const fn = defs.get("declutter_rebook_payout");
    expect(fn, "declutter_rebook_payout has a definition").toBeTruthy();
    const body = blankSqlComments(fn!.stmt).replace(/\s+/g, " ");
    expect(body).toContain("amount_cents = items_cents + delivery_cents - p_refunded_cents");
  });

  it("every handed-over 'You get' line takes the refund-aware amount and says the refund", () => {
    const uses: string[] = [];
    const offenders: string[] = [];
    for (const f of trackedFiles("src").filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.startsWith("src/test/") && !p.startsWith("src/lib/i18n/"))) {
      const code = blankComments(readFileSync(f, "utf8"));
      for (const key of HANDED_OVER_KEYS) {
        for (const m of code.matchAll(new RegExp(`t\\("${key.replace(".", "\\.")}",\\s*\\{([^}]*)\\}`, "g"))) {
          uses.push(`${f}: ${key}`);
          if (!/\bparts\b/.test(m[1])) offenders.push(`${f}: ${key} has no {parts}`);
        }
      }
      if (HANDED_OVER_KEYS.some((k) => code.includes(`"${k}"`)) && !code.includes("handedOverSellerCents(")) {
        offenders.push(`${f}: a handed-over line whose amount is not handedOverSellerCents`);
      }
    }
    expect(offenders).toEqual([]);
    expect(uses.length).toBeGreaterThan(3);
  });

  it("both languages say the refund in every handed-over line", () => {
    for (const dict of [enDeclSell, esDeclSell] as Record<string, string>[]) {
      for (const key of HANDED_OVER_KEYS) expect(dict[key], key).toContain("{parts}");
      expect(dict["dsl.refundParts"]).toMatch(/\{gross\}.*\{refunded\}/);
    }
  });
});
