import { formatPriceExact } from "@/lib/format";

/**
 * The line under a take-home figure while the one-time setup fee is still owed
 * (audit 2026-10-29 A2-C21). Owner 2026-10-25: members never see the Helpr fee
 * or its maths, so this names only the setup fee, and says "Includes" so a $120
 * job showing $111 never reads as if the $2 were the whole difference.
 */
export function setupFeeWords(firstPayoutFee: number): string {
  return `Includes the one-time $${formatPriceExact(firstPayoutFee)} setup fee, taken from your first payout.`;
}
