/**
 * Board 141, Q2326 (lh-money-escrow re-review, 2026-10-21): after the poster
 * accepts "Come back and finish", no money moves toward the Helpr before they
 * have come back, on EVERY door.
 *
 *   - The member's own write (rpc_helper_mark_done) is refused by
 *     trg_refuse_done_before_come_back: src/test/pglite/refundRequests.pglite.mjs
 *     CB12 / CB13.
 *   - create-payment "release" writes the Helpr's done stamp on the SERVICE
 *     ROLE, which that trigger lets through, so it asks the same SQL rule
 *     (refund_come_back_pending) itself, and refuses on an unreadable answer.
 *   - auto-release-payment never releases such a job INSTANTLY (the first
 *     visit's arrival and photos still pass every gate, so the poster keeps the
 *     normal 24 hours to say the Helpr never came back); an unreadable check
 *     sends every candidate to the 24-hour path.
 *
 * @mutate supabase/functions/create-payment/index.ts |         if (comeBack.pending) throw new PublicError(COME_BACK_PENDING_MESSAGE); |
 * @mutate supabase/functions/create-payment/index.ts |         if (!comeBack.ok) throw new PublicError("We couldn't check this job right now, so it wasn't marked done. Try again in a minute."); |
 * @mutate supabase/functions/create-payment/index.ts |           if (isHelper && !isPoster && !job.helper_completed_at) await newHelperCompletionGates(job);\n        }\n |         }\n
 * @mutate supabase/functions/auto-release-payment/index.ts |             if (comeBack.jobs.has(j.id)) continue; |
 * @mutate supabase/functions/_shared/refundRequestHold.ts |       .or("status.eq.coming_back,closed_reason.eq.coming_back"); |       .or("status.eq.coming_back");
 * @mutate supabase/functions/_shared/refundRequestHold.ts |     if (typeof res.data !== "boolean") return { ok: false, message: "refund_come_back_pending returned no answer" }; |
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |      AND public.refund_come_back_pending(OLD.id) THEN |      AND false THEN
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join, resolve } from "node:path";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { blankSqlComments } from "../helpers/blankNonCode";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs";
import { COME_BACK_PENDING_MESSAGE, refundComeBackPending } from "../../../supabase/functions/_shared/refundRequestHold";

const ROOT = resolve(__dirname, "../../..");
const CRON_SECRET = "test-only-cron";
const POSTER = "poster-1";
const HELPR = "helper-1";
const json = async (res: Response) => JSON.parse(await res.text()) as Record<string, unknown>;
const jobWrites = () => scenario.writes.filter((w) => w.table === "jobs" && w.op === "update");
const toPayoutPending = () => jobWrites().filter((w) => (w.payload as { payment_status?: string })?.payment_status === "payout_pending");

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
});
afterEach(() => vi.unstubAllGlobals());

async function helprMarksDone() {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_abc123" });
  scenario.authUser = { id: HELPR, email: "helpr@test.com" };
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
  // The first visit passes every completion gate: arrival confirmed, photos, hours of work.
  scenario.reads.jobs = {
    rows: [{
      id: "job-1", customer_id: POSTER, helper_id: HELPR, status: "in_progress", budget: 40, urgent_fee: 0,
      helper_fee_percent: 10, platform_fee_amount: 4, helper_confirmed_at: hoursAgo(30), poster_completed_at: null,
      helper_completed_at: null, poster_confirmed_arrival_at: hoursAgo(28), helper_arrived_at: hoursAgo(28),
      proof_before_urls: ["before.jpg"], proof_after_urls: ["after.jpg"], require_photo_proof: true,
      stripe_payment_intent_id: "pi_123", payment_status: "escrow",
    }],
  };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_123", status: "succeeded" });
  const fn = await loadEdgeFunction("create-payment");
  return fn.fetch(fn.request({ headers: { Authorization: "Bearer test-jwt" }, body: { action: "release", jobId: "job-1" } }));
}

describe("create-payment release: no new Helpr done stamp before an agreed come-back", () => {
  it("a come-back still ahead: refused in plain words, no stamp written", async () => {
    scenario.rpc.refund_come_back_pending = true;
    const res = await helprMarksDone();
    const out = await json(res);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(String(out.error)).toBe(COME_BACK_PENDING_MESSAGE);
    expect(jobWrites()).toHaveLength(0);
    expect(scenario.rpcCalls?.some((c) => c.name === "refund_come_back_pending" && (c.args as { p_job_id?: string })?.p_job_id === "job-1")).toBe(true);
  });

  it("an unreadable answer: refused (fail closed), no stamp written", async () => {
    scenario.rpcErrors = { refund_come_back_pending: { message: "connection reset", code: "08006" } };
    const res = await helprMarksDone();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(jobWrites()).toHaveLength(0);
  });

  it("the stamps cleared between the first read and the write (the sweep ran): the retry is a NEW completion and is judged again", async () => {
    // lh-money-escrow re-review (2026-10-21): the first read sees both
    // first-visit stamps, so it is no new completion and skips the gates; the
    // completing write then matches 0 rows because refund_requests_sweep
    // cleared both stamps (the come-back was accepted) in between. The re-read
    // finds them cleared: that retry must ask the come-back rule too.
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
    const base = {
      id: "job-1", customer_id: POSTER, helper_id: HELPR, status: "in_progress", budget: 40, urgent_fee: 0,
      helper_fee_percent: 10, platform_fee_amount: 4, helper_confirmed_at: hoursAgo(30),
      poster_confirmed_arrival_at: hoursAgo(28), helper_arrived_at: hoursAgo(28),
      proof_before_urls: ["before.jpg"], proof_after_urls: ["after.jpg"], require_photo_proof: true,
      stripe_payment_intent_id: "pi_123", payment_status: "escrow",
    };
    const stamped = { ...base, poster_completed_at: hoursAgo(3), helper_completed_at: hoursAgo(2) };
    const cleared = { ...base, poster_completed_at: null, helper_completed_at: null };
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_abc123" });
    scenario.authUser = { id: HELPR, email: "helpr@test.com" };
    const completingTried = () => jobWrites().some((w) => (w.payload as { payment_status?: string })?.payment_status === "payout_pending");
    scenario.reads.jobs = {
      get rows() {
        return [completingTried() ? cleared : stamped];
      },
    } as unknown as typeof scenario.reads.jobs;
    scenario.writeOverrides = [{ table: "jobs", op: "update", when: (p) => p.payment_status === "payout_pending", rows: [] }];
    scenario.rpc.refund_come_back_pending = true;
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_123", status: "succeeded" });
    const fn = await loadEdgeFunction("create-payment");
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer test-jwt" }, body: { action: "release", jobId: "job-1" } }));
    const out = await json(res);
    expect(completingTried()).toBe(true); // the race really happened
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(String(out.error)).toBe(COME_BACK_PENDING_MESSAGE);
    // No lone new done stamp was written on the retry.
    expect(jobWrites().filter((w) => (w.payload as { payment_status?: string })?.payment_status !== "payout_pending"
      && typeof (w.payload as { helper_completed_at?: unknown })?.helper_completed_at === "string")).toHaveLength(0);
  });

  it("no come-back pending: the Helpr's done is stamped as before (floor)", async () => {
    scenario.rpc.refund_come_back_pending = false;
    await helprMarksDone();
    expect(jobWrites().some((w) => typeof (w.payload as { helper_completed_at?: unknown })?.helper_completed_at === "string")).toBe(true);
  });
});

describe("refundComeBackPending", () => {
  const db = (res: { data: unknown; error: { message: string; code?: string } | null }) => ({ rpc: async () => res });
  it("answers the SQL rule; fails closed on an error or a non-answer; a database without the function has no come-backs", async () => {
    expect(await refundComeBackPending(db({ data: true, error: null }), "j")).toEqual({ ok: true, pending: true });
    expect(await refundComeBackPending(db({ data: false, error: null }), "j")).toEqual({ ok: true, pending: false });
    expect((await refundComeBackPending(db({ data: null, error: null }), "j")).ok).toBe(false);
    expect((await refundComeBackPending(db({ data: null, error: { message: "boom", code: "08006" } }), "j")).ok).toBe(false);
    expect(await refundComeBackPending(db({ data: null, error: { message: "missing", code: "PGRST202" } }), "j")).toEqual({ ok: true, pending: false });
  });
});

async function autoRelease() {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_abc", CRON_SECRET, RELEASE_PAYOUT_AUTO: "0" });
  const fn = await loadEdgeFunction("auto-release-payment");
  return fn.fetch(fn.request({ method: "POST", url: "https://edge.test/auto-release-payment", headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
}

/** One job the Helpr marked done an hour ago (not yet due), whose poster has instant release on. */
function seedInstantCandidate() {
  const job = {
    id: "job-1", title: "Assemble a bookshelf", helper_id: HELPR, customer_id: POSTER, budget: 40, platform_fee_amount: 2,
    urgent_fee: 0, poster_completed_at: null, helper_completed_at: new Date(Date.now() - 3600e3).toISOString(),
    stripe_session_id: "cs_1", stripe_payment_intent_id: "pi_1", status: "in_progress", is_group_job: false,
    helpers_needed: 1, helper_fee_percent: 8, is_seed: false,
  };
  scenario.reads.jobs = {
    // The 24-hour due set and the revision sets are empty; only the instant
    // query (the one filtered status = in_progress) finds the job.
    rows: [],
    selectOverrides: [
      { includes: "revision_acceptance_deadline", result: { rows: [] } },
      { includes: "revision_deadline", result: { rows: [] } },
    ],
    eqOverrides: [{ column: "status", value: "in_progress", result: { rows: [job] } }],
  };
  scenario.reads.gift_cards = { rows: [] };
  // The poster opted in to instant release.
  scenario.reads.profiles = { rows: [{ user_id: POSTER }] };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded" });
}
// The live-request hold read (with its dispute embed) finds nothing live.
const NO_LIVE = { includes: "disputes!", result: { rows: [] } };

describe("auto-release-payment: never INSTANTLY after an agreed come-back", () => {
  it("no come-back: the poster's instant release runs (floor: the harness reaches the instant path)", async () => {
    seedInstantCandidate();
    scenario.reads.refund_requests = { rows: [], selectOverrides: [NO_LIVE] };
    await autoRelease();
    expect(toPayoutPending().length).toBeGreaterThan(0);
  });

  it("a come-back agreed on the job: not released this pass (it waits out the normal 24 hours)", async () => {
    seedInstantCandidate();
    scenario.reads.refund_requests = { rows: [{ job_id: "job-1" }], selectOverrides: [NO_LIVE] };
    await autoRelease();
    expect(toPayoutPending()).toHaveLength(0);
    const asked = scenario.readQueries?.find((q) => q.table === "refund_requests" && q.cols === "job_id");
    expect(JSON.stringify(asked?.filters)).toContain("closed_reason.eq.coming_back");
  });

  it("an unreadable come-back check: no instant release this run, and it is a defect", async () => {
    seedInstantCandidate();
    scenario.reads.refund_requests = { error: { message: "connection reset", code: "08006" }, selectOverrides: [NO_LIVE] };
    const res = await autoRelease();
    expect(toPayoutPending()).toHaveLength(0);
    expect(res.status).toBe(500);
  });
});

describe("one rule, two doors", () => {
  it("the trigger and create-payment both read refund_come_back_pending, at its NEWEST definition", () => {
    const defs = effectiveDefs(join(ROOT, "supabase/migrations"));
    const body = (n: string) => blankSqlComments(defs.get(n)?.stmt ?? "").replace(/\s+/g, " ");
    const rule = body("refund_come_back_pending");
    expect(rule).toContain("now() < ((j.date_needed + COALESCE(j.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago')");
    expect(rule).toContain("r.status = 'coming_back' OR r.closed_reason = 'coming_back'");
    expect(body("refuse_done_before_come_back")).toContain("AND public.refund_come_back_pending(OLD.id) THEN RAISE EXCEPTION 'completion_before_come_back'");
  });
});
