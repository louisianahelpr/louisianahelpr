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
      // Default Response status is 200: send-notification-email "sent".
      vi.fn(async () => new Response(JSON.stringify({ success: true }))),
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
          link: `/posts?job=${JOB}`,
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
    scenario.reads.jobs = { rows: [job({ customer_id: POSTER, helper_id: TARGET, status: "in_progress" })] };
    scenario.reads.job_tracking = { rows: [{ status: "working" }] };
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
      link: `/posts?job=${JOB}`,
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

  it("a legacy (pre-template) client body with only title/message/type is refused (Q309: shim removed, app has not launched)", async () => {
    // The LEGACY_TITLE_TEMPLATE shim (a title->template lookup for pre-launch
    // clients that predated `template`) was removed: the app has never
    // launched, so no such client exists. A caller with no `template` and no
    // admin role falls through to "Unknown or missing notification template".
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
          link: `/jobs?job=${JOB}`,
        },
      }),
    );
    expect(res.status).toBe(400);
    expect(notificationInserts()).toHaveLength(0);
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

// ─── Q307: every template proves its EVENT, not only its sender ─────────────
//
// Q223 made the words server-built and gated each template to the right side
// of the job, but only three templates read the database to prove the event:
// the assigned Helpr could send "Dispute withdrawn" on a job with no dispute,
// and the poster "Dispute resolved ✓ … Payment will be released" (type
// payment) before resolving anything. Each template now reads the state its
// own transition writes.
//
// CLASS GUARD over the template inventory: STATE below must name EXACTLY the
// templates in NOTIFICATION_TEMPLATES (a new template with no "not reached"
// case fails the first test), and for each one the sender is the right side
// of the job, so a 409 can only come from the missing state — and the same
// send with the state present must land (a predicate that refuses everything
// is not a fix).
//
// Registered mutations - each turns this guard RED on its own:
//   Dropping the dispute proof restores the Q307 repro (withdrawn with no dispute).
// @mutate supabase/functions/_shared/notification-templates.ts | return f.dispute?.status === "withdrawn" && | return true \|\|
//   Letting any tracking row count as "working".
// @mutate supabase/functions/_shared/notification-templates.ts | f.trackingStatus !== "working" | f.trackingStatus === "nope"
//   Not reading the arrival stamp.
// @mutate supabase/functions/_shared/notification-templates.ts |     build: (f) => !f.job.poster_confirmed_arrival_at ? null : ({ |     build: (f) => ({
//   Not reading the job_offer application.
// @mutate supabase/functions/_shared/notification-templates.ts |       if (f.application?.status !== "accepted") return null; |
type Reads = Record<string, { rows: Record<string, unknown>[]; count?: number }>;
interface StateCase {
  sender: "poster" | "helper";
  /** Job columns + extra table reads for the state NOT reached. */
  notReached: { job?: Record<string, unknown>; reads?: Reads };
  /** The same, with the event recorded. */
  reached: { job?: Record<string, unknown>; reads?: Reads };
}
const withdrawnByPoster = { disputes: { rows: [{ status: "withdrawn", opener_id: POSTER }] } };
const withdrawnByHelper = { disputes: { rows: [{ status: "withdrawn", opener_id: TARGET }] } };
const STATE: Record<string, StateCase> = {
  work_started: {
    sender: "helper",
    // on_the_way already moved the job to in_progress; only the tracking row
    // says whether work has started.
    notReached: { job: { status: "in_progress" }, reads: { job_tracking: { rows: [{ status: "on_the_way" }] } } },
    reached: { job: { status: "in_progress" }, reads: { job_tracking: { rows: [{ status: "working" }] } } },
  },
  dispute_withdrawn: {
    sender: "helper",
    // The Q307 repro: no dispute on the job at all.
    notReached: { reads: { disputes: { rows: [] } } },
    reached: { job: { dispute_status: "resolved" }, reads: withdrawnByHelper },
  },
  dispute_response: {
    sender: "helper",
    notReached: { job: { dispute_status: null, dispute_helper_response: "my side" } },
    reached: { job: { dispute_status: "helper_responded", dispute_helper_response: "my side" } },
  },
  revision_acknowledged: {
    sender: "helper",
    // The review's F3 repro: the Helpr wrote their own "accepted" row (the
    // job_revisions RLS lets the assigned Helpr insert), the poster asked nothing.
    notReached: { reads: { job_revisions: { rows: [{ description: "x", status: "accepted", requested_by: TARGET }] } } },
    reached: { reads: { job_revisions: { rows: [{ description: "fix it", status: "accepted", requested_by: POSTER }] } } },
  },
  job_confirmed: {
    sender: "helper",
    // The POSTER's stamp does not prove the Helpr confirmed.
    notReached: { job: { poster_confirmed_at: "2026-09-25T00:00:00Z", helper_dayof_confirmed_at: null } },
    reached: { job: { helper_dayof_confirmed_at: "2026-09-25T00:00:00Z" } },
  },
  dispute_resolved: {
    sender: "poster",
    // The Q307 repro: a still-open dispute, "Payment will be released" before resolving.
    notReached: { job: { dispute_status: "open" }, reads: { disputes: { rows: [{ status: "open", opener_id: POSTER }] } } },
    reached: { job: { dispute_status: "resolved", payment_status: "payout_pending" }, reads: withdrawnByPoster },
  },
  revision_requested: {
    sender: "poster",
    notReached: { reads: { job_revisions: { rows: [] } } },
    reached: { reads: { job_revisions: { rows: [{ description: "fix the edge", status: "pending" }] } } },
  },
  arrival_confirmed: {
    sender: "poster",
    notReached: { job: { poster_confirmed_arrival_at: null } },
    reached: { job: { poster_confirmed_arrival_at: "2026-09-25T00:00:00Z" } },
  },
  work_confirmed: {
    sender: "poster",
    notReached: { job: { poster_confirmed_working_at: null } },
    reached: { job: { poster_confirmed_working_at: "2026-09-25T00:00:00Z" } },
  },
  job_offer: {
    sender: "poster",
    notReached: { reads: { applications: { rows: [{ status: "pending", decline_reason: null }], count: 1 } } },
    reached: { reads: { applications: { rows: [{ status: "accepted", decline_reason: null }], count: 1 } } },
  },
  application_declined: {
    sender: "poster",
    notReached: { reads: { applications: { rows: [{ status: "pending", decline_reason: null }], count: 1 } } },
    reached: { reads: { applications: { rows: [{ status: "rejected", decline_reason: null }], count: 1 } } },
  },
  no_show_reported: {
    sender: "poster",
    notReached: { reads: { user_violations: { rows: [] } } },
    reached: { reads: { user_violations: { rows: [{ action_taken: "warning" }] } } },
  },
};

describe("Q307 — every template refuses (409) when its event is not in the database", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }))));
    scenario.rpc.has_role = false;
    scenario.rpc.notification_crosses_seed_boundary = false;
    scenario.reads.push_tokens = { rows: [], count: 0 };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the state table covers EXACTLY the template inventory", () => {
    const templates = Object.keys(NOTIFICATION_TEMPLATES).sort();
    expect(templates.length).toBeGreaterThan(10);
    expect(Object.keys(STATE).sort()).toEqual(templates);
    for (const [name, c] of Object.entries(STATE)) {
      // The sender in the table is one the registry accepts, so a 409 below
      // cannot be a 403 in disguise.
      const tpl = NOTIFICATION_TEMPLATES[name];
      expect(tpl.sender === "either" || tpl.sender === c.sender, name).toBe(true);
    }
  });

  async function send(name: string, c: StateCase, side: "notReached" | "reached") {
    // Poster sends to the assigned Helpr; the Helpr sends to the poster.
    scenario.authUser = { id: c.sender === "poster" ? POSTER : TARGET };
    scenario.reads.jobs = { rows: [job({ customer_id: POSTER, helper_id: TARGET, ...(c[side].job ?? {}) })] };
    for (const [t, r] of Object.entries(c[side].reads ?? {})) scenario.reads[t] = r;
    const fn = await load();
    return fn.fetch(
      fn.request({
        headers: { Authorization: "Bearer good" },
        body: { user_id: c.sender === "poster" ? TARGET : POSTER, template: name, job_id: JOB },
      }),
    );
  }

  for (const [name, c] of Object.entries(STATE)) {
    it(`${name}: state not reached → 409, nothing inserted`, async () => {
      const res = await send(name, c, "notReached");
      expect(res.status).toBe(409);
      expect(notificationInserts()).toHaveLength(0);
    });
    it(`${name}: state reached → the notice lands`, async () => {
      const res = await send(name, c, "reached");
      expect(res.status).toBe(200);
      expect(notificationInserts()).toHaveLength(1);
    });
  }
});

// ─── Q307 second round (lh-authz-rls review of PR #1820, F2/F3/F5) ──────────
//
// Each case isolates ONE conjunct of a template's proof: every other fact is
// in its "reached" state, so only the named fact can produce the 409.
//
// @mutate supabase/functions/_shared/notification-templates.ts | && f.dispute.opener_id === f.senderId | 
// @mutate supabase/functions/_shared/notification-templates.ts |  \|\| !RELEASED.has(f.job.payment_status ?? "") | 
// @mutate supabase/functions/_shared/notification-templates.ts | f.job.status !== "in_progress" \|\| | 
// @mutate supabase/functions/_shared/notification-templates.ts |  \|\| !f.job.dispute_helper_response?.trim() | 
// @mutate supabase/functions/_shared/notification-templates.ts | (byPoster ? f.job.poster_confirmed_at : f.job.helper_dayof_confirmed_at) | (f.job.poster_confirmed_at \|\| f.job.helper_dayof_confirmed_at)
const ONE_CONJUNCT: Array<{ name: string; template: string; c: StateCase }> = [
  {
    name: "dispute_withdrawn: the dispute was withdrawn by the OTHER party",
    template: "dispute_withdrawn",
    c: { sender: "helper", notReached: { reads: withdrawnByPoster }, reached: { reads: withdrawnByHelper } },
  },
  {
    name: "dispute_resolved: withdrawn by the poster but the escrow was never released (F2 repro)",
    template: "dispute_resolved",
    c: {
      sender: "poster",
      notReached: { job: { payment_status: "escrow" }, reads: withdrawnByPoster },
      reached: { job: { payment_status: "released" }, reads: withdrawnByPoster },
    },
  },
  {
    name: "work_started: tracking says working but the job is not in progress",
    template: "work_started",
    c: {
      sender: "helper",
      notReached: { job: { status: "accepted" }, reads: { job_tracking: { rows: [{ status: "working" }] } } },
      reached: { job: { status: "in_progress" }, reads: { job_tracking: { rows: [{ status: "working" }] } } },
    },
  },
  {
    name: "dispute_response: the dispute is live but the Helpr wrote no response",
    template: "dispute_response",
    c: {
      sender: "helper",
      notReached: { job: { dispute_status: "open", dispute_helper_response: "  " } },
      reached: { job: { dispute_status: "open", dispute_helper_response: "my side" } },
    },
  },
  {
    name: "job_confirmed (poster side): only the HELPR's stamp is set",
    template: "job_confirmed",
    c: {
      sender: "poster",
      notReached: { job: { poster_confirmed_at: null, helper_dayof_confirmed_at: "2026-09-25T00:00:00Z" } },
      reached: { job: { poster_confirmed_at: "2026-09-25T00:00:00Z" } },
    },
  },
];

describe("Q307 — each proof conjunct refuses on its own", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }))));
    scenario.rpc.has_role = false;
    scenario.rpc.notification_crosses_seed_boundary = false;
    scenario.reads.push_tokens = { rows: [], count: 0 };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function send(template: string, c: StateCase, side: "notReached" | "reached") {
    scenario.authUser = { id: c.sender === "poster" ? POSTER : TARGET };
    scenario.reads.jobs = { rows: [job({ customer_id: POSTER, helper_id: TARGET, ...(c[side].job ?? {}) })] };
    for (const [t, r] of Object.entries(c[side].reads ?? {})) scenario.reads[t] = r;
    const fn = await load();
    return fn.fetch(
      fn.request({
        headers: { Authorization: "Bearer good" },
        body: { user_id: c.sender === "poster" ? TARGET : POSTER, template, job_id: JOB },
      }),
    );
  }

  for (const { name, template, c } of ONE_CONJUNCT) {
    it(`${name} → 409; with it set → lands`, async () => {
      const refused = await send(template, c, "notReached");
      expect(refused.status).toBe(409);
      expect(notificationInserts()).toHaveLength(0);
      const landed = await send(template, c, "reached");
      expect(landed.status).toBe(200);
      expect(notificationInserts()).toHaveLength(1);
    });
  }

  it("the proof reads are scoped to THIS job (and the tracking row to the caller)", async () => {
    // The mock does not match on filters, so a dropped `.eq("job_id", ...)`
    // would read the newest dispute of ANY job as the service role and stay
    // green everywhere else. Assert what was asked for.
    const eqs = (table: string) =>
      scenario.readQueries
        .filter((q) => q.table === table)
        .flatMap((q) => q.filters.filter((f) => f.op === "eq").map((f) => `${f.column}=${String(f.value)}`));
    await send("dispute_withdrawn", STATE.dispute_withdrawn, "reached");
    expect(eqs("disputes")).toContain(`job_id=${JOB}`);
    await send("work_started", STATE.work_started, "reached");
    expect(eqs("job_tracking")).toEqual(expect.arrayContaining([`job_id=${JOB}`, `helper_id=${TARGET}`]));
    await send("revision_acknowledged", STATE.revision_acknowledged, "reached");
    expect(eqs("job_revisions")).toContain(`job_id=${JOB}`);
  });
});
