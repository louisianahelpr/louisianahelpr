/**
 * Continue another day (owner 2026-11-01, Yusef's job; migration 20261101231015): while a job has an ACTIVE continue
 * day (proposed or set), auto-release-payment does not run the approval clock on it: no escalation to Helpr support
 * and no instant release. The money is untouched. A poster's own approval still releases. An unreadable check holds
 * every candidate (fail closed). The SQL side (who may set a day, the cleared done stamp, reminders for the new day)
 * is proven in src/test/pglite/jobContinueDay.pglite.mjs. The stalled-job sweep's skip is exercised in
 * src/test/edge/stalled-completion-reminder.test.ts ("continue another day").
 *
 * @mutate supabase/functions/auto-release-payment/index.ts |         if (heldByContinueDay(continuing, job.id)) { |         if (false) {
 * @mutate supabase/functions/auto-release-payment/index.ts |       if (instantIds.has(job.id) && !job.poster_completed_at && heldByContinueDay(continuing, job.id)) { |       if (false) {
 * @mutate supabase/functions/_shared/continueDay.ts |   return !read.ok \|\| read.jobs.has(jobId); |   return read.ok && read.jobs.has(jobId);
 * @mutate supabase/functions/_shared/continueDay.ts | const CONTINUE_DAY_ACTIVE_STATUSES = ["proposed", "set"] as const; | const CONTINUE_DAY_ACTIVE_STATUSES = ["set"] as const;
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { heldByContinueDay, loadContinuingJobs } from "../../../supabase/functions/_shared/continueDay";

const CRON_SECRET = "test-only-cron";
const POSTER = "poster-1";
const HELPR = "helper-1";
const json = async (res: Response) => JSON.parse(await res.text()) as Record<string, unknown>;
const toPayoutPending = () =>
  scenario.writes.filter(
    (w) => w.table === "jobs" && w.op === "update" && (w.payload as { payment_status?: string })?.payment_status === "payout_pending",
  );
const escalations = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "file_approval_escalation");

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
});
afterEach(() => vi.unstubAllGlobals());

async function autoRelease() {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_abc", CRON_SECRET, RELEASE_PAYOUT_AUTO: "0" });
  const fn = await loadEdgeFunction("auto-release-payment");
  return fn.fetch(fn.request({ method: "POST", url: "https://edge.test/auto-release-payment", headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
}

/** A job the Helpr marked done 26 h ago; `approved` = the poster approved it. */
function seedDoneJob(approved: boolean) {
  scenario.reads.jobs = {
    selectOverrides: [
      { includes: "revision_acceptance_deadline", result: { rows: [] } },
      { includes: "revision_deadline", result: { rows: [] } },
    ],
    rows: [{
      id: "job-1", title: "Clean out the garage", helper_id: HELPR, customer_id: POSTER, budget: 40, platform_fee_amount: 2,
      urgent_fee: 0, poster_completed_at: approved ? new Date(Date.now() - 25 * 3600e3).toISOString() : null,
      helper_completed_at: new Date(Date.now() - 26 * 3600e3).toISOString(),
      stripe_session_id: "cs_1", stripe_payment_intent_id: "pi_1", status: "in_progress", is_group_job: false,
      helpers_needed: 1, helper_fee_percent: 8, is_seed: false,
    }],
  };
  scenario.reads.gift_cards = { rows: [] };
  scenario.reads.profiles = { rows: [] };
  scenario.reads.refund_requests = { rows: [] };
  scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
  scenario.rpc.file_approval_escalation = true;
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded" });
}

describe("auto-release-payment: an active continue day stops the approval clock", () => {
  it("a day the Helpr proposed (done stamp still on): not escalated, and the run says why", async () => {
    seedDoneJob(false);
    scenario.reads.job_continue_days = { rows: [{ job_id: "job-1", status: "proposed" }] };
    const body = await json(await autoRelease());
    expect(escalations()).toHaveLength(0);
    expect(toPayoutPending()).toHaveLength(0);
    expect(JSON.stringify(body)).toContain("continuing");
  });

  it("no continue day: the unanswered job is escalated as before (inventory floor)", async () => {
    seedDoneJob(false);
    scenario.reads.job_continue_days = { rows: [] };
    await autoRelease();
    expect(escalations().length).toBeGreaterThan(0);
  });

  it("an unreadable continue-day list holds the job (fail closed)", async () => {
    seedDoneJob(false);
    scenario.reads.job_continue_days = { error: { message: "connection reset", code: "08006" } };
    await autoRelease();
    expect(escalations()).toHaveLength(0);
  });

  it("instant release (the poster's opt-in) waits while a continue day is active", async () => {
    seedDoneJob(false);
    (scenario.reads.jobs as { rows: Array<Record<string, unknown>> }).rows[0].helper_completed_at = new Date(Date.now() - 3600e3).toISOString();
    scenario.reads.profiles = { rows: [{ user_id: POSTER }] };
    scenario.reads.job_continue_days = { rows: [{ job_id: "job-1", status: "proposed" }] };
    await autoRelease();
    expect(toPayoutPending()).toHaveLength(0);
  });

  it("instant release without a continue day releases (inventory floor)", async () => {
    seedDoneJob(false);
    (scenario.reads.jobs as { rows: Array<Record<string, unknown>> }).rows[0].helper_completed_at = new Date(Date.now() - 3600e3).toISOString();
    scenario.reads.profiles = { rows: [{ user_id: POSTER }] };
    scenario.reads.job_continue_days = { rows: [] };
    await autoRelease();
    expect(toPayoutPending().length).toBeGreaterThan(0);
  });

  it("the poster's own approval still releases (their approval closes the continue day)", async () => {
    seedDoneJob(true);
    scenario.reads.job_continue_days = { rows: [{ job_id: "job-1", status: "set" }] };
    await autoRelease();
    expect(toPayoutPending().length).toBeGreaterThan(0);
  });
});

describe("_shared/continueDay.ts", () => {
  const db = (res: unknown) => ({ from: () => ({ select: () => ({ in: () => ({ in: async () => res }) }) }) });
  it("holds proposed and set days, fails closed on an error, holds nothing when the table is not deployed", async () => {
    const r = await loadContinuingJobs(db({ data: [{ job_id: "a", status: "proposed" }, { job_id: "b", status: "set" }, { job_id: "c", status: "finished" }], error: null }), ["a", "b", "c"]);
    expect(r.ok && [...r.jobs].sort()).toEqual(["a", "b"]);
    const bad = await loadContinuingJobs(db({ data: null, error: { message: "boom", code: "08006" } }), ["a"]);
    expect(bad.ok).toBe(false);
    expect(heldByContinueDay(bad, "zzz")).toBe(true);
    const missing = await loadContinuingJobs(db({ data: null, error: { message: "no table", code: "PGRST205" } }), ["a"]);
    expect(missing.ok && missing.jobs.size).toBe(0);
  });
});
