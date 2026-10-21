/**
 * Owner 2026-10-21: the Helpr's one-time $2 setup fee comes off the FIRST
 * payout, the payout is rounded DOWN to the whole dollar, and the take-home a
 * Helpr is shown before applying is the amount that is paid. The take-home is
 * computed on the client by TWO copies of the maths: computeNet (+
 * netAfterFirstPayoutFee, shown through formatPriceFloor) behind JobPrice,
 * JobCard, CompactJobCard and helprTakeHome, and useApplyTakeHome behind the
 * apply sheet (ApplyEarningsBreakdown, where the $2 is shown before applying)
 * and QuotePriceStepper. This guard holds BOTH to the transfer itself: it runs
 * the REAL release-payout through the edge harness and compares the Stripe
 * transfer amount with each, for flat-fee jobs with and without the setup fee
 * still owed, with and without an urgent bonus, on whole and non-whole
 * take-homes. Not covered: a Helpr-fault debt (Q2165), which no preview shows.
 *
 * @mutate src/lib/firstPayoutFee.ts |   return Math.max(0, netDollars - firstPayoutFeeDollars); |   return Math.max(0, netDollars);
 * @mutate src/lib/format.ts |   return Math.floor(Math.round(amount * 100) / 100).toLocaleString("en-US"); |   return Math.round(amount).toLocaleString("en-US");
 * @mutate src/components/dashboard/applyConfirmDialog/applyTakeHome.ts |   const payout = netAfterFirstPayoutFee(beforeFirstPayoutFee, firstPayoutFee); |   const payout = beforeFirstPayoutFee;
 * @mutate supabase/functions/release-payout/index.ts |       payoutCents = roundPayoutDownCents(unroundedPayoutCents - onboardingFeeCents); |       payoutCents = roundPayoutDownCents(unroundedPayoutCents);
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { computeNet } from "@/components/dashboard/JobPrice";
import { formatPriceFloor } from "@/lib/format";
// Called as a plain function: its only hook (useFirstPayoutFeeCents) is mocked below to a plain
// value, so no React render is needed to read the apply sheet's maths.
import { useApplyTakeHome as applyTakeHomeOf } from "@/components/dashboard/applyConfirmDialog/applyTakeHome";
import type { EnrichedJob } from "@/components/dashboard/types";

// The apply sheet reads the owed fee through this hook; the test sets what it returns.
const owed = vi.hoisted(() => ({ cents: 0 }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({
  useFirstPayoutFeeCents: () => owed.cents,
  useFirstPayoutFeeDollars: () => owed.cents / 100,
  useFirstPayoutFeeKnown: () => true,
}));

const CRON_SECRET = "cron-secret-xyz";
const SETUP_FEE_CENTS = 200;

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET,
  });
  return loadEdgeFunction("release-payout");
}

/** A flat-fee (5% + 70c) job, completed and payable, as release-payout reads it. */
function seed(budget: number, urgentFee: number, feeOwed: boolean) {
  const job = {
    id: "job-1", title: "Mow the lawn", status: "completed", payment_status: "payout_pending",
    helper_id: "helper-1", customer_id: "poster-1", budget, urgent_fee: urgentFee,
    helper_fee_percent: 5, helper_fee_flat_cents: 70,
    dispute_status: null, disputed_at: null, is_group_job: false, helpers_needed: null,
    stripe_payment_intent_id: "pi_1", stripe_session_id: null,
  };
  const captured = Math.round((budget + urgentFee) * 100);
  scenario.reads.jobs = { rows: [job] };
  scenario.reads.gift_cards = { rows: [] };
  scenario.rpc.restore_gift_card_for_job = { outcome: "would_restore", applied_cents: captured };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded", amount: captured, amount_received: captured });
  scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper", full_name: "New Helper", onboarding_fee_paid: !feeOwed }] };
  // The atomic onboarding-fee claim returns a row: this payout owns the deduction.
  if (feeOwed) scenario.writeSelectRows.profiles = [{ user_id: "helper-1" }];
  scenario.reads.platform_settings = { rows: [{ helper_fee_percent: 12, onboarding_fee_cents: SETUP_FEE_CENTS }] };
  scenario.reads.payout_transfers = { rows: [] };
  stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_helper", payouts_enabled: true, charges_enabled: true });
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_1", transfer_group: "job_job-1" });
}

/** The apply sheet's take-home for this job, in cents (useApplyTakeHome; it calls only the mocked hook). */
function applySheetCents(budget: number, urgentFee: number, feeOwed: boolean): number {
  owed.cents = feeOwed ? SETUP_FEE_CENTS : 0;
  const job = { budget, urgent_fee: urgentFee, is_group_job: false, helpers_needed: 1, helper_fee_percent: 5, helper_fee_flat_cents: 70 } as unknown as EnrichedJob;
  return Math.round(applyTakeHomeOf(job, 12).takeHome * 100);
}

/** What the take-home surfaces show for this job, in cents (formatPriceFloor of computeNet). */
function shownCents(budget: number, urgentFee: number, feeOwed: boolean): number {
  const net = computeNet(budget, 12, urgentFee, 1, feeOwed ? SETUP_FEE_CENTS / 100 : 0, { helper_fee_percent: 5, helper_fee_flat_cents: 70 }).netEarnings;
  return Number(formatPriceFloor(net).replace(/,/g, "")) * 100;
}

// Budgets chosen so the unrounded take-home has cents (60 -> $56.30) and some do not.
const CASES: Array<[number, number]> = [[60, 0], [47, 0], [47, 10], [133, 0], [25, 5], [100, 19.5], [1000, 0], [21, 0]];

describe("the take-home shown is the amount release-payout sends (owner 2026-10-21: $2 first payout, whole dollars)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });
  afterEach(() => resetEnv());

  it("inventory: the cases include cents to drop and a fee owed", () => {
    expect(CASES.length).toBeGreaterThan(5);
    const unrounded = CASES.map(([b, u]) => Math.round((b + u) * 100) - Math.round((b + u) * 5) - 70);
    expect(unrounded.some((c) => c % 100 !== 0)).toBe(true);
  });

  for (const feeOwed of [false, true]) {
    for (const [budget, urgent] of CASES) {
      it(`$${budget}${urgent ? ` + $${urgent} urgent` : ""}${feeOwed ? ", setup fee owed" : ""}: shown == transferred`, async () => {
        seed(budget, urgent, feeOwed);
        const fn = await load();
        const res = await fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: { job_id: "job-1" } }));
        expect(res.status).toBe(200);
        expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
        const sent = (stripeMock.transfers.create.mock.calls[0][0] as { amount: number }).amount;
        expect(sent % 100).toBe(0);
        expect(sent).toBe(shownCents(budget, urgent, feeOwed));
        expect(sent).toBe(applySheetCents(budget, urgent, feeOwed));
      });
    }
  }

  it("the $60 job pays $56 ($54 on a first payout), never $56.30", () => {
    expect(shownCents(60, 0, false)).toBe(5600);
    expect(shownCents(60, 0, true)).toBe(5400);
    expect(applySheetCents(60, 0, false)).toBe(5600);
    expect(applySheetCents(60, 0, true)).toBe(5400);
  });
});
