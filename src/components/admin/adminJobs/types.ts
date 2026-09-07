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
/**
 * EVERY value `jobs_payment_status_check` admits must appear here. The map was
 * missing five of the ten for as long as it has existed, and the failure was
 * silent in the worst way: `paymentColors[...] || ""` falls back to the empty
 * string, so a cancelled / abandoned / failed / chargeback / cancelling job
 * rendered its money badge with NO background and NO foreground colour — an
 * uncoloured pill on the one surface an operator uses to triage money. The
 * text was fine (`paymentStatusLabel` humanises anything), which is precisely
 * why nobody noticed: the badge read correctly and simply had no tone.
 *
 * `adminJobsPaymentTone.test.ts` now parses the CHECK constraint out of the
 * migration that last defined it and asserts this map covers it, so the two
 * cannot drift apart again. The test derives its expectation from the SQL, not
 * from this object — a registry checked against itself cannot fail for a
 * missing member.
 *
 * Tones follow the convention documented above: SUCCESS = terminal and good
 * (money has left), WARNING = in flight (money is held), INFO = in flight,
 * later stage, NEUTRAL = money never moved, DANGER = needs an operator's eyes.
 */
export const PAYMENT_TONE: Record<string, Tone> = {
  unpaid: "neutral",
  escrow: "warning",
  payout_pending: "info",
  released: "success",
  refunded: "danger",
  // Money never moved: the poster was never charged, so there is nothing to
  // reconcile and nothing to act on. Same reading as `unpaid`.
  abandoned: "neutral",
  cancelled: "neutral",
  // In flight, exactly like `escrow`: the hold still exists while the
  // cancellation unwinds it. 20260824210000 added this value for the
  // void-cancelled-payments path.
  cancelling: "warning",
  // The two that need an operator. `failed` is a charge that errored, and
  // `chargeback` is money pulled back by the bank — both are money that is not
  // where the ledger expects it to be.
  failed: "danger",
  chargeback: "danger",
};

export const paymentColors: Record<string, string> = Object.fromEntries(
  Object.entries(PAYMENT_TONE).map(([status, tone]) => [status, toneBadgeClasses[tone]]),
);
