/**
 * Lead 2026-10-22 ("file and fix"): when a Helpr's payout transfer fails or is
 * canceled, the Helpr is told (in-app + email; the SMS alert follows from the
 * notice's title, sms_kind_for 'money_problem'). Before this only Slack heard,
 * so the Helpr saw a payout that never came and nothing saying why.
 *
 * Runs the REAL stripe-webhook through the edge harness for transfer.failed and
 * transfer.canceled, on the job-payout path and the cancellation-fee path:
 *   - the notice goes to the ledger row's Helpr (or the fee transfer's
 *     destination account), with the amount, type financial_alerts;
 *   - "we'll try again" only when the job really went back to payout_pending;
 *   - one email through send-notification-email;
 *   - one notice per member per job per day (a retried payout that fails again
 *     does not notify again);
 *   - a notice that cannot be written pages ops (never silent).
 *
 * @mutate supabase/functions/stripe-webhook/handlers/transferFailed.ts |   if (failedLedger?.helper_id) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/transferCanceled.ts |   if (canceledLedger?.helper_id) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/transferFailed.ts |       requeued = true;\n | \n
 * @mutate supabase/functions/stripe-webhook/handlers/_payoutFailedNotice.ts |     if ((already?.length ?? 0) > 0) return { told: false, emailed: false, reason: "already_told_today" }; |
 * @mutate supabase/functions/stripe-webhook/handlers/_payoutFailedNotice.ts |     if (!ok) throw new Error("the in-app notice was not written"); |
 * @mutate supabase/functions/stripe-webhook/handlers/transferFailed.ts |       await tellFeePayeeFailed(supabase, transfer, logStep); |
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks, notificationEmails } from "./mocks/shared";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  return loadEdgeFunction("stripe-webhook");
}

function deliver(fn: EdgeHarness, id: string, type: string, object: Record<string, unknown>) {
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id, type, data: { object } });
  return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" } }));
}

type W = { table: string; op: string; payload: unknown };
const notices = () => (scenario.writes as W[]).filter((w) => w.table === "notifications" && w.op === "insert").map((w) => w.payload as Record<string, unknown>);

const HELPR = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";

describe("a payout transfer that fails or is canceled tells the Helpr", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
    notificationEmails.length = 0;
  });

  for (const type of ["transfer.failed", "transfer.canceled"]) {
    it(`${type}: the job's Helpr is told, with the amount, and that we will try again (job re-queued)`, async () => {
      const fn = await load();
      scenario.writeSelectRows.payout_transfers = [{ job_id: "job-ok", helper_id: HELPR, amount_cents: 5600 }];
      scenario.writeSelectRows.jobs = [{ id: "job-ok" }];
      scenario.reads.jobs = { rows: [{ id: "job-ok", status: "completed", payment_status: "released", dispute_status: null, disputed_at: null }] };
      scenario.reads.notifications = { rows: [] };
      const res = await deliver(fn, `evt_${type}_ok`, type, { id: "tr_bad", amount: 5600, destination: "acct_helper", failure_message: "account closed" });
      expect(res.status).toBe(200);
      const n = notices();
      expect(n).toHaveLength(1);
      expect(n[0]).toMatchObject({ user_id: HELPR, job_id: "job-ok", type: "financial_alerts", title: "We couldn't send your payout", link: "/profile?tab=earnings" });
      expect(String(n[0].message)).toContain("$56.00 payout didn't go through. We'll try again automatically.");
      expect(notificationEmails).toHaveLength(1);
      expect(notificationEmails[0]).toMatchObject({ user_id: HELPR, title: "We couldn't send your payout", type: "financial_alerts" });
    });

    it(`${type}: a job NOT re-queued (live dispute) says we are looking into it, not "we'll try again"`, async () => {
      const fn = await load();
      scenario.writeSelectRows.payout_transfers = [{ job_id: "job-cb", helper_id: HELPR, amount_cents: 5000 }];
      scenario.reads.jobs = { rows: [{ id: "job-cb", status: "completed", payment_status: "released", dispute_status: "stripe_chargeback", disputed_at: "2026-10-20T00:00:00Z" }] };
      scenario.reads.notifications = { rows: [] };
      await deliver(fn, `evt_${type}_cb`, type, { id: "tr_bad", amount: 5000, destination: "acct_helper", failure_message: "closed" });
      const n = notices();
      expect(n).toHaveLength(1);
      expect(String(n[0].message)).toContain("We're looking into it and will contact you.");
      expect(String(n[0].message)).not.toMatch(/try again/);
    });

    it(`${type}: told once a day per job (a retried payout that fails again stays quiet)`, async () => {
      const fn = await load();
      scenario.writeSelectRows.payout_transfers = [{ job_id: "job-ok", helper_id: HELPR, amount_cents: 5600 }];
      scenario.writeSelectRows.jobs = [{ id: "job-ok" }];
      scenario.reads.jobs = { rows: [{ id: "job-ok", status: "completed", payment_status: "released", dispute_status: null, disputed_at: null }] };
      scenario.reads.notifications = { rows: [{ id: "n-earlier" }] };
      await deliver(fn, `evt_${type}_dup`, type, { id: "tr_bad2", amount: 5600, destination: "acct_helper", failure_message: "closed" });
      expect(notices()).toHaveLength(0);
      expect(notificationEmails).toHaveLength(0);
    });

    it(`${type}: a cancellation-fee transfer tells the Helpr its destination account belongs to`, async () => {
      const fn = await load();
      scenario.reads.notifications = { rows: [] };
      scenario.writeSelectRows.cancellation_fee_transfers = [{ id: "cft-1" }];
      await deliver(fn, `evt_${type}_fee`, type, {
        id: "tr_fee", amount: 1200, destination: "acct_helper", failure_message: "closed",
        metadata: { type: "cancellation_fee", job_id: "job-x", helper_id: HELPR, fee_transfer_id: "cft-1" },
      });
      const n = notices();
      expect(n.length, JSON.stringify(scenario.writes.map((w) => `${(w as W).table}:${(w as W).op}`))).toBe(1);
      expect(n[0]).toMatchObject({ user_id: HELPR, job_id: "job-x", title: "We couldn't send your payout" });
      expect(String(n[0].message)).toContain("$12.00 payout didn't go through. We'll try again automatically.");
    });
  }

  it("a notice that cannot be written pages ops (the Helpr was NOT told)", async () => {
    const fn = await load();
    scenario.writeSelectRows.payout_transfers = [{ job_id: "job-ok", helper_id: HELPR, amount_cents: 5600 }];
    scenario.writeSelectRows.jobs = [{ id: "job-ok" }];
    scenario.reads.jobs = { rows: [{ id: "job-ok", status: "completed", payment_status: "released", dispute_status: null, disputed_at: null }] };
    scenario.reads.notifications = { rows: [] };
    scenario.writeErrors = { notifications: { message: "insert refused" } };
    const res = await deliver(fn, "evt_tf_noinsert", "transfer.failed", { id: "tr_bad", amount: 5600, destination: "acct_helper", failure_message: "closed" });
    expect(res.status).toBe(200);
    expect(slackAlerts.some((a) => /was not told/.test(String((a as { title?: string }).title)))).toBe(true);
  });
});
