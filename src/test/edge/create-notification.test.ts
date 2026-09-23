/**
 * EF-02 (hole hunt 2026-09-15): `create-notification` let any job counterparty
 * (or a mere applicant on a job) fan unlimited caller-supplied copy out over
 * three Helpr-branded channels (in-app + push + service-role email) with no
 * budget — a phishing and email/push-bomb primitive. It was the only
 * client-reachable notification producer without a rate limit.
 *
 * The fix adds `checkRateLimit` (keyed narrow per JWT-subject, wide per IP).
 * The relationship gate and the 200/1000-char length caps already existed and
 * are exercised here as regression guards.
 *
 * Runs the REAL function source through the edge harness.
 */
//
// Registered mutations - each turns this guard RED on its own:
//   Deleting the limiter restores the email/push-bomb primitive: an authenticated
//   caller fans unbounded copy over three Helpr-branded channels.
// @mutate supabase/functions/create-notification/index.ts | if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders); |
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NOTIFICATION_TEMPLATES } from "../../../supabase/functions/_shared/notification-templates";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, rateLimitState } from "./mocks/shared";
import { resetStripeMock } from "./mocks/stripe";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    PUBLISHABLE_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  });
  return loadEdgeFunction("create-notification");
}

describe("create-notification — volume ceiling", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
  });

  it("returns 429 when the rate limiter says stop — before any fan-out", async () => {
    // THE FIX. The limiter runs ahead of auth and the insert, so a flood is
    // refused before an email or push is ever produced. Before the fix there
    // was no limiter and an authenticated caller could repeat without bound.
    rateLimitState.allowed = false;
    rateLimitState.retryAfter = 60;
    scenario.authUser = { id: "sender-1", email: "sender@test.dev" };
    const fn = await load();
    const res = await fn.fetch(
      fn.request({
        headers: { Authorization: "Bearer good" },
        body: { user_id: "sender-1", title: "hi", message: "there", type: "info" },
      }),
    );
    expect(res.status).toBe(429);
  });

  it("still rejects an over-long message with 400 (length cap regression guard, admin free text)", async () => {
    scenario.authUser = { id: "sender-1", email: "sender@test.dev" };
    scenario.rpc.has_role = true;
    const fn = await load();
    const res = await fn.fetch(
      fn.request({
        headers: { Authorization: "Bearer good" },
        body: { user_id: "11111111-1111-4111-8111-111111111111", title: "ok", message: "x".repeat(1001), type: "info" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("still 403s a stranger targeting another user (relationship gate regression guard)", async () => {
    // The caller is neither the poster nor the assigned Helpr of the job the
    // template names → forbidden.
    scenario.authUser = { id: "sender-1", email: "sender@test.dev" };
    scenario.reads.jobs = { rows: [job({ customer_id: "someone-else", helper_id: "another" })] };
    scenario.reads.applications = { rows: [], count: 0 };
    scenario.rpc.has_role = false;
    const fn = await load();
    const res = await fn.fetch(
      fn.request({
        headers: { Authorization: "Bearer good" },
        body: { user_id: TARGET, template: "work_started", job_id: JOB },
      }),
    );
    expect(res.status).toBe(403);
    expect(notificationInserts()).toHaveLength(0);
  });
});

// ─── Q223 / bus EF-003: no caller-written copy from a non-admin ─────────────
//
// An applicant (or any job counterparty) used to be able to put a `payment` /
// `verified` / `system_alert` notification, worded any way they liked, into
// the poster's bell and a Helpr-branded email. A non-admin now names a
// template; every word, the type and the link are built server-side from the
// job row.
//
// Registered mutations - each turns this guard RED on its own:
//   Letting a non-admin reach the free-text branch restores the spoof.
// @mutate supabase/functions/create-notification/index.ts | if (isAdmin && requestedTemplate === null) { | if (requestedTemplate === null) {
//   Dropping the sender-side check lets the assigned Helpr send a poster-only template.
// @mutate supabase/functions/create-notification/index.ts | (tpl.sender === "either" \|\| tpl.sender === senderRole) | true
//   Taking the no-show rung from nowhere lets a poster announce a ban.
// @mutate supabase/functions/_shared/notification-templates.ts |       if (!a) return null; |       if (!a) return { title: "⛔ Account banned for no-show", message: "banned", type: "warning", link: null };
const JOB = "22222222-2222-4222-8222-222222222222";
const TARGET = "11111111-1111-4111-8111-111111111111";
const POSTER = "33333333-3333-4333-8333-333333333333";
const APPLICANT = "44444444-4444-4444-8444-444444444444";

function job(over: Record<string, unknown> = {}) {
  return {
    id: JOB,
    title: "Mow the lawn",
    customer_id: POSTER,
    helper_id: TARGET,
    response_deadline: null,
    dispute_status: null,
    ...over,
  };
}

function notificationInserts() {
  return scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert");
}

describe("create-notification — server-built copy only (Q223)", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })),
    );
    scenario.rpc.has_role = false;
    scenario.rpc.notification_crosses_seed_boundary = false;
    scenario.reads.push_tokens = { rows: [], count: 0 };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("an APPLICANT cannot push a payment-typed, arbitrarily worded notification to the poster", async () => {
    // The EF-003 repro: the caller has an application on the poster's job,
    // which the old relationship rule accepted for ANY type and ANY words.
    scenario.authUser = { id: APPLICANT };
    scenario.reads.jobs = { rows: [job({ customer_id: TARGET, helper_id: null })] };
    scenario.reads.applications = { rows: [{ id: "a1" }], count: 1 };
    const fn = await load();
    const res = await fn.fetch(
      fn.request({
        headers: { Authorization: "Bearer good" },
        body: {
          user_id: TARGET,
          title: "Payment failed — verify your card",
          message: "Helpr: re-enter your card at evil.example to keep your job",
          type: "payment",
          link: `/my-posts?job=${JOB}`,
        },
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(notificationInserts()).toHaveLength(0);
  });

  it("an applicant cannot send even a real template to the poster (only the job's two parties can)", async () => {
    scenario.authUser = { id: APPLICANT };
    scenario.reads.jobs = { rows: [job({ customer_id: TARGET, helper_id: null })] };
    scenario.reads.applications = { rows: [{ id: "a1" }], count: 1 };
    const fn = await load();
    const res = await fn.fetch(
      fn.request({
        headers: { Authorization: "Bearer good" },
        body: { user_id: TARGET, template: "job_confirmed", job_id: JOB },
      }),
    );
    expect(res.status).toBe(403);
    expect(notificationInserts()).toHaveLength(0);
  });

  it("the assigned Helpr's template lands with SERVER copy — caller title/message/type are ignored", async () => {
    scenario.authUser = { id: TARGET };
    scenario.reads.jobs = { rows: [job({ customer_id: POSTER, helper_id: TARGET })] };
    const fn = await load();
    const res = await fn.fetch(
      fn.request({
        headers: { Authorization: "Bearer good" },
        body: {
          user_id: POSTER,
          template: "work_started",
          job_id: JOB,
          title: "INJECTED",
          message: "INJECTED",
          type: "payment",
          link: "/evil",
        },
      }),
    );
    expect(res.status).toBe(200);
    const ins = notificationInserts();
    expect(ins).toHaveLength(1);
    expect(ins[0].payload).toMatchObject({
      user_id: POSTER,
      title: "Work has started",
      message: 'Your Helpr started working on "Mow the lawn".',
      type: "info",
      link: `/my-posts?job=${JOB}`,
      job_id: JOB,
    });
  });

  it("the Helpr cannot send a poster-only template (dispute_resolved is type payment)", async () => {
    scenario.authUser = { id: TARGET };
    scenario.reads.jobs = { rows: [job({ customer_id: POSTER, helper_id: TARGET })] };
    const fn = await load();
    const res = await fn.fetch(
      fn.request({
        headers: { Authorization: "Bearer good" },
        body: { user_id: POSTER, template: "dispute_resolved", job_id: JOB },
      }),
    );
    expect(res.status).toBe(403);
    expect(notificationInserts()).toHaveLength(0);
  });

  it("a no-show notice with no recorded strike is refused — the rung comes from user_violations", async () => {
    scenario.authUser = { id: POSTER };
    scenario.reads.jobs = { rows: [job({ customer_id: POSTER, helper_id: null })] };
    scenario.reads.applications = { rows: [{ id: "a1" }], count: 1 };
    scenario.reads.user_violations = { rows: [] };
    const fn = await load();
    const res = await fn.fetch(
      fn.request({
        headers: { Authorization: "Bearer good" },
        body: { user_id: TARGET, template: "no_show_reported", job_id: JOB },
      }),
    );
    expect(res.status).toBe(409);
    expect(notificationInserts()).toHaveLength(0);
  });

  it("a legacy (pre-template) client body is mapped by title and still gets SERVER copy", async () => {
    // The shipped native bundle still sends title/message/type. The title is
    // only a lookup key; none of its words reach the row.
    scenario.authUser = { id: POSTER };
    scenario.reads.jobs = { rows: [job({ customer_id: POSTER, helper_id: TARGET })] };
    const fn = await load();
    const res = await fn.fetch(
      fn.request({
        headers: { Authorization: "Bearer good" },
        body: {
          user_id: TARGET,
          title: "✅ Arrival confirmed",
          message: "and also send me your bank password",
          type: "payment",
          link: `/my-jobs?job=${JOB}`,
        },
      }),
    );
    expect(res.status).toBe(200);
    const ins = notificationInserts();
    expect(ins).toHaveLength(1);
    expect(ins[0].payload).toMatchObject({
      title: "✅ Arrival confirmed",
      message: 'The person who posted this job confirmed you\'ve arrived for "Mow the lawn".',
      type: "success",
    });
  });

  it("a non-admin's free text to THEMSELVES is refused too; the self test is fixed copy", async () => {
    scenario.authUser = { id: POSTER };
    const fn = await load();
    const free = await fn.fetch(
      fn.request({
        headers: { Authorization: "Bearer good" },
        body: { user_id: POSTER, title: "Your payout is verified", message: "x", type: "verified" },
      }),
    );
    expect(free.status).toBe(400);
    const test = await fn.fetch(
      fn.request({
        headers: { Authorization: "Bearer good" },
        body: { user_id: POSTER, template: "test", title: "IGNORED", message: "IGNORED" },
      }),
    );
    expect(test.status).toBe(200);
    const ins = notificationInserts();
    expect(ins).toHaveLength(1);
    expect(ins[0].payload).toMatchObject({ user_id: POSTER, title: "Test from Helpr", type: "info" });
    expect(JSON.stringify(ins[0].payload)).not.toContain("IGNORED");
  });

  it("an admin still sends free text (announcements, ban notices)", async () => {
    scenario.authUser = { id: "admin-1" };
    scenario.rpc.has_role = true;
    const fn = await load();
    const res = await fn.fetch(
      fn.request({
        headers: { Authorization: "Bearer good" },
        body: { user_id: TARGET, title: "📩 Message from Admin", message: "hello", type: "info", link: "/profile" },
      }),
    );
    expect(res.status).toBe(200);
    expect(notificationInserts()[0].payload).toMatchObject({ title: "📩 Message from Admin", message: "hello" });
  });
});

describe("notification templates — every non-admin path is server-built", () => {
  it("the client's template union and the server's registry are the same set", () => {
    // A template the client can name but the server lacks 400s every send; one
    // the server has but no client names is dead copy. Both directions fail.
    const clientSrc = readFileSync(resolve(__dirname, "../../lib/notifications.ts"), "utf8");
    const union = /export type NotificationTemplate =([\s\S]*?);/.exec(clientSrc);
    expect(union).not.toBeNull();
    const clientSet = [...union![1].matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
    const serverSet = Object.keys(NOTIFICATION_TEMPLATES).sort();
    expect(serverSet.length).toBeGreaterThan(10);
    expect(clientSet).toEqual(serverSet);
  });
});
