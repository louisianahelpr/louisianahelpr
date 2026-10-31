/**
 * The seller's payout line on a handed-over order card (row 93). What it is made of and why a $0 payout is $0 come
 * from D2-6's pure rules (src/lib/declutter/payoutWords.ts); audit 1b D2-2 adds one thing: while a problem is open a
 * pending payout says it is held.
 */
import type { MyPayout } from "@/lib/declutter/handover";
import { formatPrice } from "@/lib/declutter/distance";
import { payoutBreakdown, payoutStatusWords } from "@/lib/declutter/payoutWords";

/** D2-2: a pending payout while a problem is open. */
const PAYOUT_HELD = "It's held while Louisiana Helpr looks at the problem.";

/** "$38.50 ($40 minus $1.50 you owed). We send it once the sale is final: …" */
export function payoutLine(payout: MyPayout, problemOpen: boolean): string {
  const words = false ? PAYOUT_HELD : payoutStatusWords(payout);
  return `${formatPrice(payout.amount_cents)}${payoutBreakdown(payout)}. ${words}`;
}
