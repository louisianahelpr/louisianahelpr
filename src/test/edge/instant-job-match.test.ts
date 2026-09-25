/**
 * Unit tests for the `instant-job-match` edge function (Q392).
 *
 * The function used to insert "Match for you" notifications itself, at funding,
 * for every matched user: no early-access clock, no credential-tier gate, no
 * dedupe, and a poster could re-trigger it. It now writes NOTHING itself. It
 * scores the pool, drops muted users, and hands the ranked matches to
 * enqueue_instant_job_match, which applies the browse gate per recipient,
 * dedupes on (job, user) and holds each match until the job is in that user's
 * feed. That SQL is proven in PGlite
 * (src/test/pglite/jobMatchesWaitForEarlyAccess.pglite.mjs); what this file
 * proves is the edge half: who may call it, how often, what it asks for, that
 * it never falls back to writing notifications itself, and that deploy lag
 * fails closed.
 *
 * Mocked Supabase: this is a unit test of the function's branching, not
 * verification of the feature on prod.
 *
 * @mutate supabase/functions/instant-job-match/index.ts |       .not("customer_id", "is", null)\n |
 * @mutate supabase/functions/instant-job-match/index.ts |     if (!isInternal) {\n      const { allowed, retryAfter } = await checkRateLimit(req, {\n        windowMs: 10 * 60_000 |     if (false) {\n      const { allowed, retryAfter } = await checkRateLimit(req, {\n        windowMs: 10 * 60_000
 * @mutate supabase/functions/instant-job-match/index.ts |       if (mutedMatches.has(h.user_id)) continue; |
 * @mutate supabase/functions/instant-job-match/index.ts |         eligible: result.eligible ?? 0,\n |         eligible: result.eligible ?? 0,\n        matchedHelpers: matches.map((m) => m.user_id),\n
 * @mutate supabase/functions/instant-job-match/index.ts |         return new Response(\n          JSON.stringify({ notified: 0, queued: 0, skipped: "match_queue_not_deployed" }), |         await supabase.from("notifications").insert(matches.map((m) => ({ ...m, type: "job_match" })));\n        return new Response(\n          JSON.stringify({ notified: 0, queued: 0, skipped: "match_queue_not_deployed" }),
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, rateLimitCalls, rateLimitState } from "./mocks/shared";

const SERVICE = "service-key";
const JOB = "11111111-2222-4333-8444-555555555555";
const POSTER = "aaaaaaaa-0000-4000-8000-000000000001";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE,
    SUPABASE_ANON_KEY: "anon-key",
  });
  return loadEdgeFunction("instant-job-match");
}

function seed() {
  scenario.reads.jobs = {
    rows: [{
      id: JOB, title: "Clean gutters", category: "cleaning", location: "12 Canal St, New Orleans",
      budget: 80, customer_id: POSTER, is_urgent: false, payment_status: "escrow",
    }],
  };
  scenario.rpc.mask_job_location = "New Orleans, LA";
  scenario.reads.profiles = {
    rows: [
      { user_id: "u-near", full_name: "A", skills: "cleaning", location: "New Orleans", subscription_tier: null, ban_status: "active" },
      { user_id: "u-muted", full_name: "B", skills: "cleaning", location: "New Orleans", subscription_tier: null, ban_status: "active" },
      { user_id: "u-banned", full_name: "C", skills: "cleaning", location: "New Orleans", subscription_tier: null, ban_status: "banned" },
      { user_id: "u-far", full_name: "D", skills: "", location: "Shreveport", subscription_tier: null, ban_status: "active" },
    ],
  };
  scenario.reads.user_blocks = { rows: [] };
  scenario.reads.notification_preferences = { rows: [{ user_id: "u-muted", job_matches: false }] };
  scenario.rpc.enqueue_instant_job_match = { eligible: 1, queued: 1, already: 0, sent_now: 0 };
}

const call = (fn: EdgeHarness, auth: string, jobId: unknown = JOB) =>
  fn.fetch(fn.request({ headers: { Authorization: `Bearer ${auth}` }, body: { jobId } }));
const json = async (res: Response) => JSON.parse(await res.text()) as Record<string, unknown>;
const enqueueCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "enqueue_instant_job_match");
const directWrites = () => scenario.writes.filter((w) => w.table === "notifications" || w.table === "match_digest_queue");

describe("instant-job-match edge function (Q392)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("the webhook's call hands the ranked, unmuted matches to the gate and writes nothing itself", async () => {
    const fn = await load();
    seed();
    const res = await call(fn, SERVICE);
    expect(res.status).toBe(200);
    expect(enqueueCalls()).toHaveLength(1);
    const args = enqueueCalls()[0].args as { p_job_id: string; p_matches: Array<{ user_id: string; title: string; message: string; link: string }> };
    expect(args.p_job_id).toBe(JOB);
    // muted: switch off; banned: never; far: scores 0.
    expect(args.p_matches.map((m) => m.user_id)).toEqual(["u-near"]);
    expect(args.p_matches[0]).toEqual({
      user_id: "u-near",
      title: "🧹 Match for you",
      message: "Clean gutters in New Orleans, LA · $80. Tap to review and apply.",
      link: `/home?quickApply=${JOB}`,
    });
    expect(args.p_matches[0].message).not.toContain("12 Canal St");
    expect(directWrites()).toEqual([]);
    const out = await json(res);
    expect(out).toMatchObject({ notified: 0, queued: 1, eligible: 1 });
    // Counts only: the ranked candidate list never goes back to the caller.
    expect(JSON.stringify(out)).not.toContain("u-near");
    // Internal callers are never rate-limited: the webhook must not skip a match.
    expect(rateLimitCalls).toEqual([]);
  });

  it("asks only for an open, funded, owned job with no live direct offer", async () => {
    const fn = await load();
    seed();
    await call(fn, SERVICE);
    const read = (scenario.readQueries ?? []).find((q) => q.table === "jobs");
    expect(read?.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "eq", column: "id", value: JOB }),
      expect.objectContaining({ op: "eq", column: "status", value: "open" }),
      expect.objectContaining({ op: "in", column: "payment_status", value: ["escrow", "payout_pending", "released"] }),
      expect.objectContaining({ op: "not", column: "customer_id" }),
    ]));
  });

  it("an ownerless or unmatchable job answers 200 and asks the gate nothing", async () => {
    const fn = await load();
    seed();
    scenario.reads.jobs = { rows: [] };
    const res = await call(fn, SERVICE);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ notified: 0, skipped: "job_not_matchable" });
    expect(enqueueCalls()).toEqual([]);
    expect(directWrites()).toEqual([]);
  });

  it("before its migration deploys (PGRST202) it fails CLOSED: nothing is sent", async () => {
    const fn = await load();
    seed();
    scenario.rpcErrors = { enqueue_instant_job_match: { message: "Could not find the function", code: "PGRST202" } };
    const res = await call(fn, SERVICE);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ notified: 0, skipped: "match_queue_not_deployed" });
    expect(directWrites()).toEqual([]);
  });

  it("any other gate error is a 500 with a fixed message, and nothing is sent", async () => {
    const fn = await load();
    seed();
    scenario.rpcErrors = { enqueue_instant_job_match: { message: "relation job_match_queue does not exist", code: "42P01" } };
    const res = await call(fn, SERVICE);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("job_match_queue");
    expect(directWrites()).toEqual([]);
  });

  it("a poster may trigger their own job at most once per 10 minutes per job", async () => {
    const fn = await load();
    seed();
    scenario.authUser = { id: POSTER };
    const res = await call(fn, "user-jwt");
    expect(res.status).toBe(200);
    expect(rateLimitCalls).toEqual([
      { windowMs: 60_000, maxRequests: 20, keyPrefix: "instant-job-match" },
      { windowMs: 600_000, maxRequests: 1, keyPrefix: `instant-job-match:job:${JOB}` },
    ]);
    rateLimitState.allowed = false;
    const again = await call(fn, "user-jwt");
    expect(again.status).toBe(429);
  });

  it("refuses a caller who does not own the job, and a malformed jobId", async () => {
    const fn = await load();
    seed();
    scenario.authUser = { id: "bbbbbbbb-0000-4000-8000-000000000002" };
    expect((await call(fn, "user-jwt")).status).toBe(403);
    expect((await call(fn, "user-jwt", "not-a-uuid")).status).toBe(400);
    expect(enqueueCalls()).toEqual([]);
  });

  it("refuses an unauthenticated caller", async () => {
    const fn = await load();
    seed();
    const res = await fn.fetch(fn.request({ body: { jobId: JOB } }));
    expect(res.status).toBe(401);
    expect(enqueueCalls()).toEqual([]);
  });
});
