/**
 * D2-6 (audit 1b #6, prod 2026-10-29): a sale refunded in full read "$0 after the buyer's refund. Nothing to pay out:
 * this sale covered an amount you owed from an earlier refund", though nothing owed was taken. The $0 reason now comes
 * from the payout row: refunded_cents (the refund) and debt_cents (what owed was actually taken).
 *
 * @mutate src/lib/declutter/payoutWords.ts |   if ((p.refunded_cents ?? 0) >= sale) return "Nothing to pay out: the buyer was refunded for this sale."; |
 * @mutate src/lib/declutter/payoutWords.ts |   if (p.debt_cents > 0) return "Nothing to pay out: this sale covered an amount you owed from an earlier refund."; |
 * @mutate src/lib/declutter/payoutWords.ts |   const sale = p.items_cents + (p.delivery_cents ?? 0); |   const sale = p.items_cents + (p.delivery_cents ?? 0) + 1;
 * @mutate src/lib/declutter/payoutWords.ts | p.debt_cents > 0 ? ` after the buyer's refund and ${formatPrice(p.debt_cents)} you owed` : | false ? "" :
 *
 * NIGHT-SELL-soldstates-4 (buying.md #47): a failed payout says honestly whether we are still trying. The payout run
 * stops after its last try (the NEWEST declutter_payouts_due: attempts < 12, read below) and nothing restarts it but
 * Support; the seller reads attempts through the column grant 20261031184338 (proof:
 * src/test/pglite/declutterPayoutAttemptsReadable.pglite.mjs).
 * @mutate src/lib/declutter/payoutWords.ts |   if ((p.status === "failed" \|\| p.status === "pending") && (p.attempts ?? 0) >= PAYOUT_TRIES) return PAYOUT_GAVE_UP; |
 * @mutate src/lib/declutter/payoutWords.ts |   if ((p.status === "failed" \|\| p.status === "pending") && | if (p.status === "failed" &&
 * @mutate src/lib/declutter/payoutWords.ts | export const PAYOUT_TRIES = 12; | export const PAYOUT_TRIES = 13;
 * @mutate src/lib/declutter/payoutWords.ts |   if (p.status === "failed" && p.attempts === undefined) return PAYOUT_FAILED_UNKNOWN; |
 * @mutate src/lib/declutter/handover.ts |   const res = await supabase.from("declutter_payouts").select(`${cols}, attempts`).eq("seller_id", userId); |   const res = await supabase.from("declutter_payouts").select(cols).eq("seller_id", userId);
 * @mutate supabase/migrations/20261031184338_declutter_payout_attempts_readable.sql | GRANT SELECT (attempts) ON TABLE public.declutter_payouts TO authenticated; | GRANT SELECT (status) ON TABLE public.declutter_payouts TO authenticated;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PAYOUT_TRIES, payoutBreakdown, payoutStatusWords } from "./payoutWords";
import { blankSqlComments } from "@/test/helpers/blankNonCode";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";

const row = (over: Partial<{ attempts: number; status: "pending" | "succeeded" | "failed" | "nothing_due"; items_cents: number; delivery_cents: number; refunded_cents: number; debt_cents: number }> = {}) => ({
  status: "nothing_due" as const, items_cents: 2000, delivery_cents: 0, refunded_cents: 0, debt_cents: 0, ...over,
});

describe("D2-6: the $0 payout says why, from the payout row", () => {
  it("refunded in full (the audit's case): the refund, never an amount owed", () => {
    const p = row({ refunded_cents: 2000 });
    expect(payoutStatusWords(p)).toBe("Nothing to pay out: the buyer was refunded for this sale.");
    expect(payoutBreakdown(p)).toBe(" after the buyer's refund");
  });

  it("a seller delivery refunded in full counts its rate too", () => {
    expect(payoutStatusWords(row({ delivery_cents: 500, refunded_cents: 2500 }))).toBe("Nothing to pay out: the buyer was refunded for this sale.");
    expect(payoutStatusWords(row({ delivery_cents: 500, refunded_cents: 2000 }))).not.toMatch(/refunded for this sale/);
  });

  it("an earlier amount owed that this sale covered", () => {
    expect(payoutStatusWords(row({ debt_cents: 2000 }))).toBe("Nothing to pay out: this sale covered an amount you owed from an earlier refund.");
  });

  it("a part refund plus an amount owed: both named, each from what was taken", () => {
    const p = row({ refunded_cents: 1931, debt_cents: 69 });
    expect(payoutStatusWords(p)).toBe("Nothing to pay out: this sale covered an amount you owed from an earlier refund.");
    expect(payoutBreakdown(p)).toBe(" after the buyer's refund and $0.69 you owed");
  });

  it("other statuses keep their words; nothing owed and no refund says only that", () => {
    expect(payoutStatusWords(row({ status: "pending" }))).toMatch(/^We send it once the sale is final/);
    expect(payoutStatusWords(row())).toBe("Nothing to pay out.");
    expect(payoutBreakdown(row({ status: "succeeded", debt_cents: 150 }))).toBe(" ($20 minus $1.50 you owed)");
  });
});

describe("soldstates-4: a failed payout says whether we are still trying", () => {
  it("before the last try: we try again on our own; after it: we stopped, message Support", () => {
    const tries = (attempts: number) => payoutStatusWords(row({ status: "failed", items_cents: 4000, attempts }));
    expect(tries(1)).toBe("Your payout didn't go through yet. We'll try again on our own. If it still doesn't arrive, message Support.");
    expect(tries(PAYOUT_TRIES - 1)).toMatch(/We'll try again on our own/);
    expect(tries(PAYOUT_TRIES)).toBe("Your payout didn't go through and we've stopped trying. Message Support and we'll look into it.");
    // Never a promise to pay: the last try can be a refunded or disputed charge (declutter-money pageIfLastTry).
    expect(tries(PAYOUT_TRIES)).not.toMatch(/we'll send it|we will pay|you'll get/i);
    expect(tries(PAYOUT_TRIES + 3)).toMatch(/stopped trying/);
  });

  // Lead 10-31 (B18's money finding): a rebook or a held row's release sets a row back to pending without resetting its
  // tries, and the run takes only attempts < 12, so a pending row at 12 is never paid on its own: Support, not "we send it".
  it("a pending row at the last try or past it says Support, never that we send it", () => {
    const pending = (attempts: number) => payoutStatusWords(row({ status: "pending", items_cents: 4000, attempts }));
    expect(pending(PAYOUT_TRIES)).toMatch(/stopped trying\. Message Support/);
    expect(pending(PAYOUT_TRIES + 1)).not.toMatch(/^We send it/);
    expect(pending(PAYOUT_TRIES - 1)).toMatch(/^We send it once the sale is final/);
    expect(pending(0)).toMatch(/^We send it once the sale is final/);
  });

  it("try count unknown (the grant not live yet): the old words, which promise no retry", () => {
    const p = { status: "failed" as const, items_cents: 4000, delivery_cents: 0, refunded_cents: 0, debt_cents: 0 };
    expect(payoutStatusWords(p)).toBe("Your payout didn't go through yet. Check that your payout account is set up. If it still doesn't arrive, message Support.");
  });

  it("PAYOUT_TRIES is the newest declutter_payouts_due's cap, and the seller can read attempts", () => {
    const dir = resolve(process.cwd(), "supabase/migrations");
    const def = effectiveDefs(dir).get("declutter_payouts_due");
    expect(def, "declutter_payouts_due is defined").toBeTruthy();
    const caps = [...blankSqlComments(def!.stmt).matchAll(/p\.attempts\s*<\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(caps).toEqual([PAYOUT_TRIES]);
    const grant = blankSqlComments(readFileSync(resolve(dir, "20261031184338_declutter_payout_attempts_readable.sql"), "utf8"));
    expect(grant).toMatch(/GRANT SELECT \(attempts\) ON TABLE public\.declutter_payouts TO authenticated;/);
    const handover = readFileSync(resolve(process.cwd(), "src/lib/declutter/handover.ts"), "utf8");
    expect(handover).toMatch(/from\("declutter_payouts"\)\.select\(`\$\{cols\}, attempts`\)/);
  });
});
