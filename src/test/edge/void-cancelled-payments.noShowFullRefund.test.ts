// @mutate supabase/functions/void-cancelled-payments/index.ts |          noShowFullRefund = markRow?.no_show_reported_at != null; |          noShowFullRefund = false;
// @mutate supabase/functions/void-cancelled-payments/index.ts |          noShowFullRefund = !violErr && (noShowRows?.length ?? 0) > 0; |          noShowFullRefund = false;
// @mutate supabase/functions/_shared/posterCancelSplit.ts |   const noCardFee = i.sellerFault \|\| i.platformFault === true \|\| i.noShowFullRefund === true; |   const noCardFee = i.sellerFault \|\| i.platformFault === true;
// @mutate supabase/functions/_shared/posterCancelSplit.ts |     setupFeeCents: i.noShowFullRefund === true ? 0 : setupFeeKeptCents(i.job), |     setupFeeCents: setupFeeKeptCents(i.job),
// @mutate supabase/functions/void-cancelled-payments/index.ts |         if (noShowErr) { |         if (false) {
// @mutate supabase/functions/void-cancelled-payments/index.ts |      if (job.is_group_job !== true && job.helper_confirmed_at == null) {\n        const { data: markRow | if (job.is_group_job !== true) {\n        const { data: markRow
// @mutate supabase/functions/void-cancelled-payments/index.ts |        let noShowErr: { message: string } \| null = markErr && !markNotDeployed ? markErr : null; |        let noShowErr: { message: string } \| null = null;
/**
 * F272 (owner 11-11 ~2:50 PM): a no-show job's refund is FULL.
 *
 * report_helper_no_show reopens the job; if the poster picks no new date and nobody new is hired, auto-expire-jobs
 * cancels it and void-cancelled-payments refunds it. That refund returns every cent the poster paid: the card fee
 * and a first job's $2 setup fee included (the business absorbs them). Keyed on the job's server-owned no-show marker
 * (jobs.no_show_reported_at, 20261111213317) with no confirmed Helpr now, NOT on the Helpr's user_violations row
 * (account deletion and an admin reversal delete it: F272 review note 1); an ordinary cancel keeps today's rule; a
 * failed read moves no money this run. Before the column is deployed (42703) the violation row is read instead.
 * Against the REAL function source, with void-cancelled-payments.declutterSellerFault.test.ts's harness.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock, PAYABLE_CONNECT_ACCOUNT } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret-f272";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_f272",
    CRON_SECRET,
  });
  return loadEdgeFunction("void-cancelled-payments");
}
const cronReq = () =>
  new Request("https://x/functions/v1/void-cancelled-payments", {
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });

const STRIPE_FEE = 668;

/**
 * A $200 job paid $200 + a $20 card-cost fee line + the $2 first-job setup fee ($222.00 captured), its Helpr
 * reported as a no-show (the reopen cleared helper_id and helper_confirmed_at), cancelled by auto-expire-jobs.
 */
type ReadErr = { message: string; code?: string };
function seed(opts: {
  /** jobs.no_show_reported_at as the marker read returns it, or that read's error. */
  marker: { at?: string | null; error?: ReadErr };
  /** The struck Helpr's user_violations rows (read only when the marker column is not deployed). */
  noShow?: { rows?: Array<Record<string, unknown>>; error?: ReadErr };
  confirmedHelper?: boolean;
}) {
  scenario.reads.jobs = {
    selectOverrides: [
      {
        includes: "cancellation_fee",
        result: {
          rows: [{
            id: "job-f272",
            title: "Mow and Weed Eat",
            stripe_session_id: null,
            stripe_payment_intent_id: "pi_f272",
            budget: 200,
            customer_fee_amount: 20,
            onboarding_fee_amount: 2,
            cancellation_fee: 0,
            date_needed: "2024-06-25",
            start_time: "09:00:00",
            // Days before the start: an ordinary cancel owes no late fee, so only the fee rule differs.
            cancelled_at: "2024-06-20T05:00:00Z",
            helper_id: opts.confirmedHelper ? "helper-2" : null,
            helper_confirmed_at: opts.confirmedHelper ? "2024-06-19T12:00:00Z" : null,
            customer_id: "poster-1",
            helper_fee_percent: 10,
            is_group_job: false,
            helpers_needed: 1,
          }],
        },
      },
      {
        includes: "no_show_reported_at",
        result: opts.marker.error ? { rows: [], error: opts.marker.error } : { rows: [{ no_show_reported_at: opts.marker.at ?? null }] },
      },
    ],
    rows: [],
  };
  const v = opts.noShow ?? {};
  scenario.reads.user_violations = v.error ? { rows: [], error: v.error } : { rows: v.rows ?? [] };
  scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper", subscription_tier: null }] };
  const captured = 22200;
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_f272", status: "succeeded", amount: captured, amount_received: captured,
    latest_charge: { id: "ch_f272", balance_transaction: { fee: STRIPE_FEE } },
  });
  stripeMock.refunds.create.mockResolvedValue({ id: "re_f272", amount: 1 });
  return captured;
}
const NO_SHOW = { rows: [{ id: 41 }] };
const REPORTED = { at: "2024-06-19T15:00:00Z" };
const NOT_DEPLOYED = { error: { message: 'column jobs.no_show_reported_at does not exist', code: "42703" } };
const refundLedger = () => scenario.writes.find((w) => w.table === "payment_refunds");

describe("void-cancelled-payments: a no-show job is refunded in full (F272)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock(); stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT);
    resetSharedMocks();
  });

  it("refunds every cent: the card fee and the $2 setup fee included", async () => {
    const captured = seed({ marker: REPORTED, noShow: NO_SHOW });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_f272", amount: captured },
      { idempotencyKey: "cancel-refund-job-f272" },
    );
    expect(refundLedger()?.payload).toMatchObject({ amount_cents: 1, is_partial: false, reason: expect.stringContaining("Helpr no-show") });
  });

  it("review note 1: the struck Helpr deleted their account (no violation row left): still a full refund", async () => {
    const captured = seed({ marker: REPORTED, noShow: { rows: [] } });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_f272", amount: captured },
      { idempotencyKey: "cancel-refund-job-f272" },
    );
  });

  it("an ordinary cancel (no marker on the job) keeps today's rule: the card fee and the setup fee are kept", async () => {
    // A violation row with no marker is not the key (only report_helper_no_show stamps the marker).
    const captured = seed({ marker: { at: null }, noShow: NO_SHOW });
    const h = await load();
    await h.fetch(cronReq());
    // posterCancelKeptFeeCents keeps the $20 fee line (no poster-fee stamp) and the $2 setup fee.
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_f272", amount: captured - 2000 - 200 },
      { idempotencyKey: "cancel-refund-job-f272" },
    );
  });

  it("a no-show job where a new Helpr was hired and confirmed keeps today's rule", async () => {
    const captured = seed({ marker: REPORTED, noShow: NO_SHOW, confirmedHelper: true });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_f272", amount: captured - 2000 - 200 },
      { idempotencyKey: "cancel-refund-job-f272" },
    );
  });

  it("a failed read of the marker moves no money this run", async () => {
    seed({ marker: { error: { message: "jobs down", code: "XX000" } }, noShow: NO_SHOW });
    const h = await load();
    const res = await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(JSON.stringify(await res.json())).toContain("no_show_read_failed");
  });

  it("before the column is deployed (42703) the violation row is the key: full refund", async () => {
    const captured = seed({ marker: NOT_DEPLOYED, noShow: NO_SHOW });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_f272", amount: captured },
      { idempotencyKey: "cancel-refund-job-f272" },
    );
  });

  it("before the column is deployed, a failed violation read moves no money this run", async () => {
    seed({ marker: NOT_DEPLOYED, noShow: { error: { message: "violations down", code: "XX000" } } });
    const h = await load();
    const res = await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(JSON.stringify(await res.json())).toContain("no_show_read_failed");
  });
});
