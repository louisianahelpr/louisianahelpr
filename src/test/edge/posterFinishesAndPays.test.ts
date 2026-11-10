/**
 * THE POSTER FINISHES THE JOB AND RELEASES THE MONEY (owner 11-10, her job "Mow and Weed Eat" 7b1da54b: in progress,
 * $100 held, its continue day passed with no done from the Helpr, and the poster had only "Change day" and "Message").
 *
 * create-payment 'release' with posterFinishes: true runs the REAL function source (edge harness):
 *   - the rule (public.poster_finish_job_refusal, PGlite: src/test/pglite/posterFinishesAndPays.pglite.mjs) is asked
 *     with the TOKEN's user id, and its refusal or an unreadable answer moves nothing;
 *   - the write is the poster's Approve: the SAME helperPayout, the same payout day, pinned to held escrow and to
 *     the row as read (helper_completed_at still NULL), and it writes no Helpr done stamp;
 *   - only the poster: the Helpr sending the flag is refused before any rule or write;
 *   - a replay answers alreadyReleased with no second write; without the flag nothing changed (the poster's tap
 *     still waits on the Helpr).
 *
 * @mutate supabase/functions/create-payment/index.ts | helperDone = isHelper \|\| posterFinishes ? true : !!job.helper_completed_at; | helperDone = isHelper ? true : !!job.helper_completed_at;
 * @mutate supabase/functions/create-payment/index.ts |         if (refusal) throw new PublicError(posterFinishRefusalMessage(String(refusal))); |
 * @mutate supabase/functions/create-payment/index.ts |       await posterFinishRefusal(job);\n\n      // 3. MINIMUM JOB TIME |       // 3. MINIMUM JOB TIME
 * @mutate supabase/functions/create-payment/index.ts |       const posterFinishes = body.posterFinishes === true && !forPoster && isPoster && !isHelper; |       const posterFinishes = body.posterFinishes === true;
 * @mutate supabase/functions/create-payment/index.ts | const released = row.status === "completed" && !!row.poster_completed_at && (!!row.helper_completed_at \|\| posterFinishes); | const released = row.status === "completed" && !!row.poster_completed_at && !!row.helper_completed_at;
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock, PAYABLE_CONNECT_ACCOUNT } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { posterFinishOpen, posterFinishRefusalMessage } from "../../../supabase/functions/_shared/posterFinish";

const POSTER = { id: "poster-1", email: "poster@test.com" };
const HELPR = { id: "helper-1", email: "helper@test.com" };
const daysAgo = (d: number) => new Date(Date.now() - d * 86400e3).toISOString();
const json = async (res: Response) => JSON.parse(await res.text()) as Record<string, unknown>;
const jobUpdates = () => scenario.writes.filter((w) => w.table === "jobs" && w.op === "update");

/** Yusef's job as it stands on prod (11-10): in progress, money held, day 1's done cleared, never marked done again. */
const yusefJob = (over: Record<string, unknown> = {}) => ({
  id: "job-1", title: "Mow and Weed Eat", customer_id: POSTER.id, helper_id: HELPR.id, status: "in_progress", budget: 100,
  urgent_fee: 0, helper_fee_percent: 10, platform_fee_amount: 10, is_group_job: false, payment_status: "escrow",
  helper_arrived_at: daysAgo(9), poster_confirmed_arrival_at: daysAgo(9), helper_arrival_verified_at: daysAgo(9),
  poster_completed_at: null, helper_completed_at: null, stripe_payment_intent_id: "pi_123", date_needed: "2026-11-01", start_time: "09:00:00",
  ...over,
});

async function release(user: { id: string; email: string }, job: Record<string, unknown>, body: Record<string, unknown> = {}) {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_abc123" });
  scenario.authUser = user;
  scenario.reads.jobs = { rows: [job] };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_123", status: "succeeded" });
  const fn = await loadEdgeFunction("create-payment");
  const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer test-jwt" }, body: { action: "release", jobId: "job-1", ...body } }));
  return { res, out: await json(res) };
}

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT);
  resetSupabaseMock();
  resetSharedMocks();
});

describe("create-payment release: the poster finishes the job (posterFinishes)", () => {
  it("pays exactly what the poster's Approve pays, on the same day, and asks the rule with the token's user", async () => {
    // The existing Approve: the Helpr marked done, the poster approves.
    const approve = await release(POSTER, yusefJob({ helper_completed_at: daysAgo(1) }));
    expect(approve.out.bothDone).toBe(true);
    const approvePayload = jobUpdates()[0]?.payload as Record<string, unknown>;

    resetSupabaseMock();
    resetSharedMocks();
    scenario.rpc.poster_finish_job_refusal = null; // allowed
    const before = Date.now();
    const finish = await release(POSTER, yusefJob(), { posterFinishes: true });
    expect(finish.res.status).toBe(200);
    expect(finish.out.bothDone).toBe(true);
    expect(finish.out.helperPayout).toBe(approve.out.helperPayout);
    expect(finish.out.helperPayout).toBe(90);
    expect(finish.out.platformFee).toBe(approve.out.platformFee);

    const call = scenario.rpcCalls?.find((c) => c.name === "poster_finish_job_refusal");
    expect(call?.args).toEqual({ p_job_id: "job-1", p_user_id: POSTER.id });

    const w = jobUpdates();
    expect(w).toHaveLength(1);
    const payload = w[0].payload as Record<string, unknown>;
    expect(payload.status).toBe("completed");
    expect(payload.payment_status).toBe("payout_pending");
    expect(payload.poster_completed_at).toBeTruthy();
    // No Helpr done stamp is written on their behalf.
    expect("helper_completed_at" in payload).toBe(false);
    // The same payout day as the Approve: 3 days after the poster's tap.
    const due = Date.parse(String(payload.payout_scheduled_at));
    const approveDue = Date.parse(String(approvePayload.payout_scheduled_at));
    expect(Math.abs(due - approveDue)).toBeLessThan(60_000);
    expect(due - before).toBeGreaterThan(2.9 * 86400e3);
    // Pinned to the row as read and to held escrow.
    expect(w[0].filters).toContainEqual({ op: "eq", column: "payment_status", value: "escrow" });
    expect(w[0].filters).toContainEqual({ op: "is", column: "helper_completed_at", value: null });
    expect(w[0].filters).toContainEqual({ op: "is", column: "poster_completed_at", value: null });
    // The Helpr is told the job was approved; no "check it and confirm" ask.
    const notes = scenario.writes.filter((x) => x.table === "notifications")
      .flatMap((x) => (Array.isArray(x.payload) ? x.payload : [x.payload]) as Record<string, unknown>[]);
    expect(notes.some((n) => n.user_id === HELPR.id && n.title === "Job approved!")).toBe(true);
    expect(notes.some((n) => n.title === "Job marked complete")).toBe(false);
  });

  it("a refusal from the rule moves nothing and says why in plain words", async () => {
    scenario.rpc.poster_finish_job_refusal = "day_not_reached";
    const { out } = await release(POSTER, yusefJob(), { posterFinishes: true });
    expect(out.error).toBe(posterFinishRefusalMessage("day_not_reached"));
    expect(jobUpdates()).toHaveLength(0);
  });

  it("an unreadable rule fails closed", async () => {
    scenario.rpcErrors = { poster_finish_job_refusal: { message: "boom" } };
    const { out } = await release(POSTER, yusefJob(), { posterFinishes: true });
    expect(String(out.error)).toMatch(/couldn't check this job/i);
    expect(jobUpdates()).toHaveLength(0);
  });

  it("the Helpr sending the flag is refused before any rule or write", async () => {
    scenario.rpc.poster_finish_job_refusal = null;
    const { out } = await release(HELPR, yusefJob(), { posterFinishes: true });
    expect(out.error).toBe(posterFinishRefusalMessage("not_the_poster"));
    expect(scenario.rpcCalls?.some((c) => c.name === "poster_finish_job_refusal")).toBe(false);
    expect(jobUpdates()).toHaveLength(0);
  });

  it("an admin acting for the poster (forPoster) cannot use it", async () => {
    scenario.rpc.has_role = true;
    scenario.rpc.poster_finish_job_refusal = null;
    scenario.reads.job_approval_escalations = { rows: [{ job_id: "job-1" }] };
    const { out } = await release({ id: "admin-1", email: "a@test.com" }, yusefJob(), { posterFinishes: true, forPoster: true });
    expect(out.error).toBeTruthy();
    expect(scenario.rpcCalls?.some((c) => c.name === "poster_finish_job_refusal")).toBe(false);
    expect(jobUpdates()).toHaveLength(0);
  });

  it("a stranger is refused", async () => {
    const { out } = await release({ id: "stranger", email: "s@test.com" }, yusefJob(), { posterFinishes: true });
    expect(String(out.error)).toMatch(/not authorized/i);
    expect(jobUpdates()).toHaveLength(0);
  });

  it("a replay after it was released answers alreadyReleased with no second write", async () => {
    scenario.rpc.poster_finish_job_refusal = "not_in_progress";
    const { out } = await release(POSTER, yusefJob({ status: "completed", payment_status: "payout_pending", poster_completed_at: daysAgo(0) }), { posterFinishes: true });
    expect(out.alreadyReleased).toBe(true);
    expect(jobUpdates()).toHaveLength(0);
  });

  it("without the flag the poster's tap is unchanged: it still waits on the Helpr", async () => {
    const { out } = await release(POSTER, yusefJob());
    expect(out.bothDone).toBe(false);
    expect(scenario.rpcCalls?.some((c) => c.name === "poster_finish_job_refusal")).toBe(false);
    expect((jobUpdates()[0]?.payload as Record<string, unknown>).status).not.toBe("completed");
  });
});

describe("posterFinishOpen (the job page's mirror of the rule, for the button only)", () => {
  const now = Date.parse("2026-11-10T18:00:00Z");
  const job = yusefJob();
  it("Yusef's job with its continue day (Fri 11/6 3:15 PM) passed: open", () => {
    expect(posterFinishOpen(job, { status: "set", new_date: "2026-11-06", new_start_time: "15:15:00" }, now)).toBe(true);
  });
  it("a continue day still ahead: closed", () => {
    expect(posterFinishOpen(job, { status: "set", new_date: "2026-11-12", new_start_time: "09:00:00" }, now)).toBe(false);
  });
  it("no continue day: the job's own start decides", () => {
    expect(posterFinishOpen(job, null, now)).toBe(true);
    expect(posterFinishOpen({ ...job, date_needed: "2026-11-11" }, null, now)).toBe(false);
  });
  it("closed once the Helpr marked done, for a crew, without held money, during a dispute, or off in_progress", () => {
    expect(posterFinishOpen({ ...job, helper_completed_at: daysAgo(1) }, null, now)).toBe(false);
    expect(posterFinishOpen({ ...job, is_group_job: true }, null, now)).toBe(false);
    expect(posterFinishOpen({ ...job, payment_status: "payout_pending" }, null, now)).toBe(false);
    expect(posterFinishOpen({ ...job, has_active_dispute: true }, null, now)).toBe(false);
    expect(posterFinishOpen({ ...job, status: "accepted" }, null, now)).toBe(false);
  });
});
