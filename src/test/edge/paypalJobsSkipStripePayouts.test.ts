/**
 * PayPal Plan A, phase 4: the hourly Stripe payout cron (process-scheduled-payouts) never pays a job
 * that was paid through PayPal, and never sends its Helpr the Stripe "Payout account required ... Add it
 * in Profile → Payments" notice. The job goes to the admin "Pay this Helpr" queue
 * (paypal_queue_manual_payout); when its Helpr has no PayPal email that can be paid yet, the Helpr is
 * asked for one ("Add your PayPal email to get paid"), at most once a day per job (phase 2 review,
 * lead 2026-10-23).
 *
 * Runs the REAL function source (and the REAL _shared/payments/manualPayoutQueue.ts) via the edge harness.
 *
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |       if (queued.outcome === "waiting_for_payee") { |       if (false) {
 * @mutate supabase/functions/_shared/payments/manualPayoutQueue.ts |     if ((data ?? []).length > 0) return "already_told"; |     if (false) return "already_told";
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |     const jobs = (selectedJobs ?? []).filter((j) => !paypalIds.ids.has(j.id as string)); |     const jobs = (selectedJobs ?? []);
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock, PAYABLE_CONNECT_ACCOUNT } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret-xyz";
const TITLE = "Add your PayPal email to get paid";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET,
  });
  return loadEdgeFunction("process-scheduled-payouts");
}

function seedPaypalJob(opts: { queue: Record<string, unknown>; alreadyTold?: boolean }) {
  scenario.reads.jobs = {
    rows: [{
      id: "job-pp", title: "Fence repair", helper_id: "helper-1", customer_id: "poster-1", budget: 100,
      urgent_fee: 0, helper_fee_percent: 8, helper_fee_flat_cents: 70, status: "completed", is_group_job: false,
      helpers_needed: 1, is_seed: false, stripe_payment_intent_id: null, stripe_session_id: null,
    }],
  };
  // The job is PayPal's: a captured provider_payments row.
  scenario.reads.provider_payments = { rows: [{ subject_id: "job-pp", id: "pay-1", env: "sandbox", status: "captured" }] };
  scenario.reads.platform_settings = { rows: [{ onboarding_fee_cents: 200 }] };
  // No Stripe account at all: if the Stripe path ran, it would send "Payout account required".
  scenario.reads.profiles = { rows: [{ stripe_account_id: null, onboarding_fee_paid: true, subscription_tier: null, subscription_expires_at: null }] };
  scenario.reads.payout_transfers = { rows: [] };
  scenario.reads.user_roles = { rows: [] };
  scenario.reads.notifications = { rows: opts.alreadyTold ? [{ id: "n-earlier" }] : [] };
  scenario.rpc.paypal_queue_manual_payout = opts.queue;
}

const run = async () => {
  const fn = await load();
  return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
};
const notices = () =>
  scenario.writes
    .filter((w) => w.table === "notifications" && w.op === "insert")
    .flatMap((w) => (Array.isArray(w.payload) ? w.payload : [w.payload]) as Array<{ title?: string; link?: string; user_id?: string }>);

describe("process-scheduled-payouts: a PayPal-paid job (phase 4)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock(); stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT);
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("goes to the PayPal pay queue, never to a Stripe transfer", async () => {
    seedPaypalJob({ queue: { outcome: "queued", payout_id: "po-1" } });
    const res = await run();
    expect(res.status).toBe(200);
    const calls = (scenario.rpcCalls ?? []).filter((c) => c.name === "paypal_queue_manual_payout");
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toMatchObject({ p_job_id: "job-pp", p_helper_id: "helper-1", p_source: "process-scheduled-payouts" });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(notices().map((n) => n.title)).not.toContain("Payout account required");
  });

  it("no PayPal email yet: the Helpr is asked for one, never the Stripe 'Payout account required' notice", async () => {
    seedPaypalJob({ queue: { outcome: "waiting_for_payee", reason: "no_payable_paypal_account" } });
    const res = await run();
    expect(res.status).toBe(200);
    const sent = notices();
    expect(sent.map((n) => n.title)).toEqual([TITLE]);
    expect(sent[0]).toMatchObject({ user_id: "helper-1", link: "/profile?tab=payment" });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("asked at most once a day per job (the cron runs hourly)", async () => {
    seedPaypalJob({ queue: { outcome: "waiting_for_payee", reason: "no_payable_paypal_account" }, alreadyTold: true });
    const res = await run();
    expect(res.status).toBe(200);
    expect(notices()).toEqual([]);
  });

  it("an unreadable provider_payments read pays nobody this run (fail closed)", async () => {
    seedPaypalJob({ queue: { outcome: "queued" } });
    scenario.reads.provider_payments = { error: { message: "boom" } };
    const res = await run();
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });
});
