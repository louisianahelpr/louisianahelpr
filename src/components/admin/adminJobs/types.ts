import type { Database } from "@/integrations/supabase/types";
import { JOB_CATEGORY_LABELS } from "@/lib/jobCategories";
import { toneBadgeClasses, type Tone } from "@/components/admin/tones";

export type Job = Database["public"]["Tables"]["jobs"]["Row"];

// Canonical labels — see `src/lib/jobCategories.ts`.
export const categoryLabels: Record<string, string> = JOB_CATEGORY_LABELS;

/**
 * THE payment-status tone map for the admin console — one meaning per colour.
 *
 * There were two maps for the same `payment_status` enum and they disagreed:
 * this file painted `escrow` green (`bg-primary/10 text-primary`) and
 * `released` neutral grey (`bg-secondary`), while `PayoutsDrillDown` in
 * AdminAnalyticsDrilldowns painted `escrow` amber and `released` green. So an
 * admin reading the Jobs list and then the Payouts drill-down saw the same
 * money state in two different colours, with green meaning "held" on one
 * screen and "paid out" on the other — colour carrying two meanings, which is
 * exactly what the console cannot afford on the escrow surface.
 *
 * The drill-down's reading is the correct one and is now the only one, because
 * it matches the platform-wide convention: GREEN = the terminal, good state
 * (money has left); AMBER = the step currently in flight (money is held);
 * NEUTRAL = not reached yet; the single alarm colour = reversed. Both call
 * sites derive from this map, so they cannot drift again.
 */
export const PAYMENT_TONE: Record<string, Tone> = {
  unpaid: "neutral",
  escrow: "warning",
  payout_pending: "info",
  released: "success",
  refunded: "danger",
};

export const paymentColors: Record<string, string> = Object.fromEntries(
  Object.entries(PAYMENT_TONE).map(([status, tone]) => [status, toneBadgeClasses[tone]]),
);
