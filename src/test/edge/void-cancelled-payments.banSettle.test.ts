// @mutate supabase/functions/void-cancelled-payments/index.ts | const nonRefundableCents = Math.max(serviceFeeCents, actualOrEstimatedFeeCents(pi, capturedCents)); | const nonRefundableCents = serviceFeeCents;
// @mutate supabase/functions/void-cancelled-payments/index.ts | jobCancellationFee = computeCancellationFee(job); | jobCancellationFee = 0;
/**
 * Q327: a job the permanent-ban path cancels is settled by
 * void-cancelled-payments exactly like a poster's own cancel, and the platform
 * never absorbs a fee (owner, Q407 (12)).
 *
 * settle_one_off_jobs_for_banned_account (20260925234251) writes a cancelled
 * job with cancelled_by NULL, its own reason text, and the fee poster_cancel_job
 * would charge. Part A never reads either of the first two: it recomputes the
 * fee from budget / date / start / cancelled_at / helper_confirmed_at
 * (F-MONEY-32), so these rows carry exactly Part A's own select list. What is
 * proven here, against the REAL function source:
 *   - a committed Helpr on a booking the ban cancelled 10h out is paid the 25%
 *     fee (minus their live commission), and the poster is refunded the rest
 *     minus max(service fee, Stripe's actual processing fee);
 *   - when Stripe's fee is larger than the service fee, the larger is withheld
 *     (the platform never pays Stripe's cut out of its own pocket);
 *   - a ban-cancelled open job (no Helpr) pays nobody a fee and refunds all
 *     but that same non-refundable floor.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret-ban";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_ban",
    CRON_SECRET,
  });
  return loadEdgeFunction("void-cancelled-payments");
}
const cronReq = () =>
  new Request("https://x/functions/v1/void-cancelled-payments", {
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });

/**
 * $200 booking starting 2024-06-25 10:00 Central (15:00Z), cancelled by the
 * ban path at 05:00Z: 10 hours out, the 25% tier when the Helpr confirmed.
 * Captured $220 (budget + $20 service fee).
 */
function seedBanCancelled(opts: { helper: boolean; serviceFee: number; stripeFeeCents: number }) {
  scenario.reads.jobs = {
    selectOverrides: [
      {
        includes: "cancellation_fee",
        result: {
          rows: [{
            id: "job-ban",
            title: "Haul a couch",
            stripe_session_id: null,
            stripe_payment_intent_id: "pi_ban",
            budget: 200,
            customer_fee_amount: opts.serviceFee,
            cancellation_fee: opts.helper ? 50 : 0,
            date_needed: "2024-06-25",
            start_time: "10:00:00",
            cancelled_at: "2024-06-25T05:00:00Z",
            helper_id: opts.helper ? "helper-1" : null,
            helper_confirmed_at: opts.helper ? "2024-06-20T12:00:00Z" : null,
            customer_id: "poster-1",
            helper_fee_percent: 10,
            is_group_job: false,
            helpers_needed: 1,
          }],
        },
      },
    ],
    rows: [],
  };
  scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper", subscription_tier: null }] };
  const captured = 20000 + Math.round(opts.serviceFee * 100);
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_ban", status: "succeeded", amount: captured, amount_received: captured,
    latest_charge: { id: "ch_ban", balance_transaction: { fee: opts.stripeFeeCents } },
  });
  stripeMock.refunds.create.mockResolvedValue({ id: "re_ban", amount: 1 });
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_ban_fee" });
  return captured;
}

describe("void-cancelled-payments settles a ban-cancelled job like a poster cancel (Q327)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  it("pays the committed Helpr the 25% fee and refunds the rest minus the service fee", async () => {
    const captured = seedBanCancelled({ helper: true, serviceFee: 20, stripeFeeCents: 668 });
    const h = await load();
    await h.fetch(cronReq());
    // $50 fee at the Helpr's live tier (no subscription = free tier, 12%): $44.00.
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    expect((stripeMock.transfers.create.mock.calls[0][0] as { amount: number }).amount).toBe(4400);
    // 22000 - 5000 fee - max(2000 service, 668 Stripe) = 15000.
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_ban", amount: captured - 5000 - 2000 },
      { idempotencyKey: "cancel-refund-job-ban" },
    );
  });

  it("withholds Stripe's processing fee when it is larger than the service fee: the platform never absorbs it", async () => {
    const captured = seedBanCancelled({ helper: true, serviceFee: 0, stripeFeeCents: 610 });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_ban", amount: captured - 5000 - 610 },
      { idempotencyKey: "cancel-refund-job-ban" },
    );
  });

  it("a ban-cancelled job with no Helpr pays no fee and refunds all but the non-refundable floor", async () => {
    const captured = seedBanCancelled({ helper: false, serviceFee: 20, stripeFeeCents: 668 });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_ban", amount: captured - 2000 },
      { idempotencyKey: "cancel-refund-job-ban" },
    );
  });
});
