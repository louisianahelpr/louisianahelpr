/**
 * Board 141 (docs/OPEN.md Q2272): while a refund request on a job is LIVE (open,
 * declined with its dispute not filed yet, or agreed and not yet split), no
 * money leaves toward the Helpr.
 *
 * The database refuses escrow -> payout_pending on every path
 * (refuse_payout_pending_while_refund_requested, 20261021102943; behaviour in
 * src/test/pglite/refundRequests.pglite.mjs H1, AG8, DC2, D8). This file pins
 * the layers above it, on the REAL sources through the edge harness:
 *   - auto-release-payment treats a held job as an OUTCOME ("refund_requested")
 *     and moves nothing; an unreadable read releases nothing (fail closed);
 *   - the release button (create-payment "release") answers the refusal with
 *     plain words, never "try again";
 *   - _shared/refundRequestHold.ts's isLiveRefundRequest is the SQL rule
 *     refund_request_is_live, row for row (the SQL's three clauses pinned on
 *     its NEWEST definition, and the trigger wired to it);
 *   - account deletion (Q2273) is refused while the member has a live request:
 *     src/test/moneyOwedBlocksAccountDeletion.test.ts.
 *
 * @mutate supabase/functions/auto-release-payment/index.ts |       if (!refundHeld.ok \|\| refundHeld.jobs.has(job.id)) { |       if (false) {
 * @mutate supabase/functions/create-payment/index.ts |           if (isRefundRequestHoldRefusal(String(updateError.message ?? ""))) { |           if (false) {
 * @mutate supabase/functions/_shared/refundRequestHold.ts |   if (row.status === "open") return true; |   if (row.status === "open") return false;
 * @mutate supabase/functions/_shared/refundRequestHold.ts |     if (!d) return true; |     if (!d) return false;
 * @mutate supabase/functions/_shared/refundRequestHold.ts |   if (row.status === "declined") return row.dispute_id === null \|\| row.dispute_id === undefined; |   if (row.status === "declined") return false;
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |   EXECUTE FUNCTION public.refuse_payout_pending_while_refund_requested(); |   EXECUTE FUNCTION public.update_updated_at_column();
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |   BEFORE UPDATE OF status, helper_id ON public.jobs |   BEFORE UPDATE OF status ON public.jobs
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { blankSqlComments } from "../helpers/blankNonCode";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs";
import {
  isLiveRefundRequest,
  loadRefundHeldJobs,
  REFUND_REQUEST_RELEASE_MESSAGE,
  type RefundRequestRow,
} from "../../../supabase/functions/_shared/refundRequestHold";

const ROOT = resolve(__dirname, "../../..");
/** The embedded dispute a refund_requests read returns (status, execution_status). */
const embed = (status: string, execution_status: string) => ({ status, execution_status });
const CRON_SECRET = "test-only-cron";
const POSTER = "poster-1";
const HELPR = "helper-1";
const json = async (res: Response) => JSON.parse(await res.text()) as Record<string, unknown>;
const toPayoutPending = () =>
  scenario.writes.filter(
    (w) => w.table === "jobs" && w.op === "update" && (w.payload as { payment_status?: string })?.payment_status === "payout_pending",
  );

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

function seedDueJob() {
  scenario.reads.jobs = {
    selectOverrides: [
      { includes: "revision_acceptance_deadline", result: { rows: [] } },
      { includes: "revision_deadline", result: { rows: [] } },
    ],
    rows: [{
      id: "job-1", title: "Assemble a bookshelf", helper_id: HELPR, customer_id: POSTER, budget: 40, platform_fee_amount: 2,
      urgent_fee: 0, poster_completed_at: null, helper_completed_at: new Date(Date.now() - 48 * 3600e3).toISOString(),
      stripe_session_id: "cs_1", stripe_payment_intent_id: "pi_1", status: "in_progress", is_group_job: false,
      helpers_needed: 1, helper_fee_percent: 8, is_seed: false,
    }],
  };
  scenario.reads.gift_cards = { rows: [] };
  scenario.reads.profiles = { rows: [] };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded" });
}

describe("auto-release-payment: a live refund request holds the job", () => {
  it("an open request: the finished job is NOT completed or queued to pay, and the run says why", async () => {
    seedDueJob();
    scenario.reads.refund_requests = { rows: [{ job_id: "job-1", status: "open", dispute_id: null }] };
    const res = await autoRelease();
    const body = await json(res);
    expect(toPayoutPending()).toHaveLength(0);
    expect(JSON.stringify(body)).toContain("refund_requested");
    expect(res.status).toBe(200);
  });

  it("an agreed request whose split has not run holds it too", async () => {
    seedDueJob();
    scenario.reads.refund_requests = { rows: [{ job_id: "job-1", status: "agreed", dispute_id: "d-1", disputes: embed("decided", "pending") }] };
    await autoRelease();
    expect(toPayoutPending()).toHaveLength(0);
  });

  it("no live request: the job is released as before (inventory floor)", async () => {
    seedDueJob();
    scenario.reads.refund_requests = { rows: [{ job_id: "job-1", status: "agreed", dispute_id: "d-1", disputes: embed("decided", "executed") }] };
    await autoRelease();
    expect(toPayoutPending().length).toBeGreaterThan(0);
  });

  it("an unreadable request list releases nothing this run (fail closed) and is a defect", async () => {
    seedDueJob();
    scenario.reads.refund_requests = { error: { message: "connection reset", code: "08006" } };
    const res = await autoRelease();
    expect(toPayoutPending()).toHaveLength(0);
    expect(res.status).toBe(500);
  });
});

describe("create-payment release: the refusal is said in plain words", () => {
  it("a release refused because a refund request is live answers the hold, never 'try again'", async () => {
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_abc123" });
    scenario.authUser = { id: POSTER, email: "poster@test.com" };
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_existing" }] });
    const longAgo = new Date(Date.now() - 48 * 3600e3).toISOString();
    scenario.reads.jobs = {
      rows: [{
        id: "job-1", customer_id: POSTER, helper_id: HELPR, status: "in_progress", budget: 40, urgent_fee: 0,
        helper_fee_percent: 10, platform_fee_amount: 4, helper_confirmed_at: longAgo, poster_completed_at: null,
        helper_completed_at: longAgo, stripe_payment_intent_id: "pi_123", payment_status: "escrow",
      }],
    };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_123", status: "succeeded" });
    scenario.writeOverrides = [{ table: "jobs", op: "update", when: (p) => p.payment_status === "payout_pending", error: { message: "refund_request_open", code: "23514" } }];
    const fn = await loadEdgeFunction("create-payment");
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer test-jwt" }, body: { action: "release", jobId: "job-1" } }));
    const out = await json(res);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(String(out.error)).toBe(REFUND_REQUEST_RELEASE_MESSAGE);
    expect(String(out.error)).not.toMatch(/try again/i);
  });
});

describe("isLiveRefundRequest is the SQL rule refund_request_is_live", () => {
  const row = (r: Partial<RefundRequestRow>): RefundRequestRow => ({ job_id: "j", status: "open", dispute_id: null, ...r });
  it.each([
    ["open", row({ status: "open" }), true],
    ["declined, dispute not filed", row({ status: "declined", dispute_id: null }), true],
    ["declined, dispute filed", row({ status: "declined", dispute_id: "d" }), false],
    ["agreed, split pending", row({ status: "agreed", dispute_id: "d", disputes: embed("decided", "pending") }), true],
    ["agreed, split failed", row({ status: "agreed", dispute_id: "d", disputes: embed("decided", "failed") }), true],
    ["agreed, dispute unreadable", row({ status: "agreed", dispute_id: "d", disputes: null }), true],
    ["agreed, split executed", row({ status: "agreed", dispute_id: "d", disputes: embed("decided", "executed") }), false],
    ["agreed, decision superseded", row({ status: "agreed", dispute_id: "d", disputes: embed("superseded", "pending") }), false],
    ["finish offered", row({ status: "finish_offered" }), false],
    ["expired (dispute filed)", row({ status: "expired", dispute_id: "d" }), false],
    ["closed", row({ status: "closed" }), false],
  ])("%s", (_name, r, live) => {
    expect(isLiveRefundRequest(r)).toBe(live);
  });

  it("the SQL rule and the trigger on jobs, at their NEWEST definitions", () => {
    const defs = effectiveDefs(join(ROOT, "supabase/migrations"));
    const rule = blankSqlComments(defs.get("refund_request_is_live")?.stmt ?? "").replace(/\s+/g, " ");
    expect(rule.length).toBeGreaterThan(200);
    expect(rule).toContain("p_status = 'open'");
    expect(rule).toContain("(p_status = 'declined' AND p_dispute_id IS NULL)");
    expect(rule).toContain("d.execution_status = 'executed' OR d.status <> 'decided'");
    const trig = blankSqlComments(defs.get("refuse_payout_pending_while_refund_requested")?.stmt ?? "");
    expect(trig).toContain("public.refund_request_is_live(r.status, r.dispute_id)");
    expect(trig).toContain("refund_request_open");
    const mig = blankSqlComments(readFileSync(join(ROOT, "supabase/migrations/20261021102943_refund_requests.sql"), "utf8")).replace(/\s+/g, " ");
    // No reopen, cancel or Helpr swap under a live request (behaviour: refundRequests.pglite.mjs M1-M3).
    const move = blankSqlComments(defs.get("refuse_job_move_while_refund_requested")?.stmt ?? "").replace(/\s+/g, " ");
    expect(move).toContain("public.refund_request_is_live(r.status, r.dispute_id)");
    expect(move).toContain("NEW.helper_id IS DISTINCT FROM OLD.helper_id");
    expect(mig).toContain(
      "CREATE TRIGGER trg_refuse_job_move_while_refund_requested BEFORE UPDATE OF status, helper_id ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.refuse_job_move_while_refund_requested();",
    );
    expect(mig).toContain(
      "CREATE TRIGGER trg_refuse_payout_pending_while_refund_requested BEFORE UPDATE OF payment_status ON public.jobs FOR EACH ROW WHEN (OLD.payment_status = 'escrow' AND NEW.payment_status = 'payout_pending') EXECUTE FUNCTION public.refuse_payout_pending_while_refund_requested();",
    );
  });

  it("loadRefundHeldJobs fails closed on a read error and holds nothing when the table is not deployed", async () => {
    const db = (res: unknown) => ({ from: () => ({ select: () => ({ in: () => ({ in: async () => res }) }) }) });
    expect((await loadRefundHeldJobs(db({ data: null, error: { message: "boom", code: "08006" } }), ["j"])).ok).toBe(false);
    const missing = await loadRefundHeldJobs(db({ data: null, error: { message: "missing", code: "PGRST205" } }), ["j"]);
    expect(missing.ok && missing.jobs.size === 0).toBe(true);
    const held = await loadRefundHeldJobs(db({ data: [{ job_id: "j", status: "open", dispute_id: null }], error: null }), ["j"]);
    expect(held.ok && held.jobs.has("j")).toBe(true);
  });
});
