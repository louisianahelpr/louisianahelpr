/**
 * Unit tests for the `engagement-automations` Supabase edge function — the
 * lifecycle cron that mails welcome-drip steps, approval reminders and the
 * "New jobs are open in your area." win-back to REAL people, daily.
 *
 * THE DEFECT THESE PIN — and why it is the worst one in this lane
 *
 * The run opens by loading two consent lists and refuses to send if either
 * cannot be read:
 *
 *   • `suppressed_emails`        — hard bounces and spam complaints
 *   • `notification_preferences` — the Promotions opt-out and what a one-click
 *                                  unsubscribe writes
 *
 * Both reads were unbounded `.select()`s. PostgREST caps a result at
 * `db-max-rows = 1000` and ignores any larger `.limit()` — measured against
 * prod on 2026-09-01, `notifications?select=id&limit=5000` on a 1,619-row
 * table returned exactly 1000. So past the thousandth row the sets silently
 * stop containing the rest, every `suppressedSet.has(...)` answers false for a
 * hard-bounced address, every `promoOptedOut.has(...)` answers false for
 * someone who unsubscribed, and the mail goes out — with the fail-closed guard
 * still present, still executing, and still returning 200.
 *
 * That is strictly worse than the guard not existing, because it is the reason
 * nobody looks. So an INCOMPLETE list now aborts exactly as a FAILED one does:
 * an unsent campaign is retryable, one sent to people who opted out is not.
 *
 * Runs the REAL function source through the edge harness, including the real
 * `_shared/paginate.ts` and `_shared/cron-result.ts`.
 */
// @mutate supabase/functions/engagement-automations/index.ts |         .filter((p) => p.email_promotions === false \|\| p.email_enabled === false) |         .filter((p) => p.email_promotions !== true \|\| p.email_enabled === false)
// @mutate supabase/functions/engagement-automations/index.ts |       if (comeBackRecently.has(user.user_id)) continue\n\n      const signupDate |       const signupDate
// @mutate supabase/functions/engagement-automations/index.ts |       if (comeBackRecently.has(user.user_id)) continue\n\n      // Only send re-engagement |       // Only send re-engagement
// @mutate supabase/functions/engagement-automations/index.ts |     if (comeBackScan.error \|\| !comeBackScan.complete) { |     if (false) {
// @mutate supabase/functions/engagement-automations/index.ts |           .gte('claimed_at', comeBackSince) |           .gte('claimed_at', new Date(0).toISOString())
// @mutate supabase/functions/engagement-automations/index.ts |       .eq('is_seed', false)\n      .is('anonymized_at', null)\n      .eq('ban_status', 'active'),\n    ) |     )
// @mutate supabase/functions/engagement-automations/index.ts |         .eq('is_seed', false)\n        .is('anonymized_at', null)\n        .eq('ban_status', 'active'),\n    ) |     )
// @mutate supabase/functions/engagement-automations/index.ts |       if (!(daysSinceSignup <= WELCOME_DRIP_MAX_DAYS)) continue | 
// @mutate supabase/functions/engagement-automations/index.ts |       if (!(daysSinceSignup <= WELCOME_DRIP_MAX_DAYS)) continue |       if (!(daysSinceSignup <= WELCOME_DRIP_MAX_DAYS + 1)) continue
// @mutate supabase/functions/engagement-automations/index.ts |         .gte('created_at', welcomeWindowStart) | 
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetEmailMocks, emailRenders } from "./mocks/email";

const CRON_SECRET = "cron-secret";

/** Every run reads the owner's daily summary counts (OPS-1); a quiet day answers zeros, as the server would. */
function seedQuietDay() {
  scenario.rpc.owner_daily_summary_stats = {
    new_users: 0, jobs_posted: 0, items_posted: 0, jobs_completed: 0, items_sold: 0, sales_cents: 0,
    open_reports: 0, failed_payouts: 0, member_errors: 0, members_with_errors: 0, top_sources: [],
  };
}

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    CRON_SECRET,
  });
  return loadEdgeFunction("engagement-automations");
}

function cronRequest(fn: EdgeHarness) {
  return fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

const TWO_DAYS_AGO = new Date(Date.now() - 2 * 86_400_000).toISOString();

/**
 * One consenting, verified, approved profile due drip step 1, with both
 * consent lists readable and empty.
 */
function seedOneDripRecipient(dripCount?: number) {
  scenario.reads.suppressed_emails = { rows: [] };
  scenario.reads.notification_preferences = { rows: [] };
  // The store resolves reads by TABLE NAME, and this function reads `profiles`
  // four separate times for four different cohorts. Without per-select
  // overrides the one seeded row satisfies all of them at once and a "one drip
  // email" assertion silently measures the mock. Keyed on a column unique to
  // each cohort's projection; the win-back and admin-digest reads name neither,
  // so they fall through to the empty base.
  scenario.reads.profiles = {
    rows: [],
    selectOverrides: [
      {
        includes: "drip_step",
        result: {
          rows: [
            {
              user_id: "user-1",
              full_name: "Dana",
              email: "dana@example.com",
              drip_step: 0,
              last_drip_at: null,
              created_at: TWO_DAYS_AGO,
            },
          ],
          ...(dripCount === undefined ? {} : { count: dripCount }),
        },
      },
      { includes: "approval_email_count", result: { rows: [] } },
    ],
  };
  scenario.reads.user_roles = { rows: [] };
  scenario.reads.jobs = { rows: [] };
  scenario.reads.messages = { rows: [] };
  scenario.reads.reports = { rows: [] };
}

/** Every `enqueue_email` RPC the run made. */
function queued() {
  return (scenario.rpcCalls ?? []).filter((c) => c.name === "enqueue_email");
}

describe("engagement-automations edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    seedQuietDay();
  });

  it("rejects a request without the cron bearer", async () => {
    const fn = await loadConfigured();
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
  });

  it("queues one drip email for an eligible, consenting recipient", async () => {
    const fn = await loadConfigured();
    seedOneDripRecipient();

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.drip).toBe(1);
    expect(queued()).toHaveLength(1);
    // The right step was selected — day 2 since signup with `drip_step: 0`
    // is step 1, not 2 or 3.
    expect((emailRenders[0] as { type: { name: string } }).type.name).toBe("WelcomeDripStep1Email");
  });

  it("ABORTS 503 when the suppression list cannot be READ — nothing is mailed", async () => {
    const fn = await loadConfigured();
    seedOneDripRecipient();
    scenario.reads.suppressed_emails = { error: { message: "permission denied" } };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(503);
    expect(String(b.error)).toContain("Suppression list unavailable");
    expect(queued()).toHaveLength(0);
  });

  it("ABORTS 503 when the suppression list is TRUNCATED — the headline fix", async () => {
    // The shape the 1000-row cap actually produces: rows come back, no error,
    // and only the server's own count says four fifths of the list is missing.
    // Under the old unbounded read this was indistinguishable from a complete
    // list, and the mail went to whoever was past row 1000 — hard bounces and
    // spam complainers included.
    const fn = await loadConfigured();
    seedOneDripRecipient();
    scenario.reads.suppressed_emails = {
      rows: [{ email: "bounced@example.com" }],
      count: 1619,
    };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(503);
    expect(String(b.error)).toContain("Suppression list incomplete");
    expect(String(b.details)).toContain("read 1 of 1619 rows");
    expect(queued()).toHaveLength(0);
  });

  it("ABORTS 503 when the promotions opt-out list is TRUNCATED", async () => {
    // `notification_preferences` holds one row per user, so it crosses 1000
    // before anything else here does — and the first person past that boundary
    // who switched Promotions off is simply absent from the opt-out set.
    const fn = await loadConfigured();
    seedOneDripRecipient();
    scenario.reads.notification_preferences = {
      rows: [{ user_id: "someone", email_promotions: false }],
      count: 4000,
    };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(503);
    expect(String(b.error)).toContain("Email preference list incomplete");
    expect(String(b.details)).toContain("read 1 of 4000 rows");
    expect(queued()).toHaveLength(0);
  });

  it("honours a suppressed address that IS in a complete list", async () => {
    const fn = await loadConfigured();
    seedOneDripRecipient();
    // Case-insensitively, as the real list is stored.
    scenario.reads.suppressed_emails = { rows: [{ email: "DANA@example.com" }] };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.drip).toBe(0);
    expect(queued()).toHaveLength(0);
  });

  it("honours a Promotions opt-out", async () => {
    const fn = await loadConfigured();
    seedOneDripRecipient();
    scenario.reads.notification_preferences = {
      rows: [{ user_id: "user-1", email_promotions: false }],
    };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.drip).toBe(0);
    expect(queued()).toHaveLength(0);
  });

  // Q2299 (owner, 2026-10-21): the sign-up box ALONE is enough for the
  // welcome drip and the win-back. email_promotions NULL is "never chosen"
  // (20261021135832) and is not an opt-out; only an explicit false is.
  it("mails a box-ticked member whose Promotions email was never chosen (NULL)", async () => {
    const fn = await loadConfigured();
    seedOneDripRecipient();
    scenario.reads.notification_preferences = {
      rows: [{ user_id: "user-1", email_promotions: null, email_enabled: true }],
    };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.drip).toBe(1);
    expect(queued()).toHaveLength(1);
  });

  it("does not drip a member claimed for a come-back email in the last 20 hours (never two the same day)", async () => {
    const fn = await loadConfigured();
    seedOneDripRecipient();
    scenario.reads.come_back_email_sends = { rows: [{ user_id: "user-1" }] };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.drip).toBe(0);
    expect(queued()).toHaveLength(0);
    const read = (scenario.readQueries ?? []).find((q) => q.table === "come_back_email_sends");
    const since = read?.filters.find((f) => f.op === "gte" && f.column === "claimed_at")?.value as string | undefined;
    expect(since, "reads only the claims of the last 20 hours").toBeDefined();
    const hours = (Date.now() - new Date(since!).getTime()) / 3_600_000;
    expect(hours).toBeGreaterThan(19.9);
    expect(hours).toBeLessThan(20.1);

    // Control: without the claim the same member IS dripped.
    scenario.reads.come_back_email_sends = { rows: [] };
    const again = await body(await fn.fetch(cronRequest(fn)));
    expect(again.drip).toBe(1);
  });

  it("the welcome drip and the win-back leave out seed, anonymised and banned accounts (the come-back claim's exclusions)", async () => {
    const fn = await loadConfigured();
    seedOneDripRecipient();
    await fn.fetch(cronRequest(fn));
    const cohorts = (scenario.readQueries ?? []).filter(
      (q) => q.table === "profiles" && /marketing_consent|last_drip_at/.test(q.cols ?? "") && (q.filters ?? []).some((f) => f.column === "marketing_consent"),
    );
    expect(cohorts.length).toBeGreaterThanOrEqual(2);
    for (const q of cohorts) {
      const has = (op: string, column: string, value: unknown) =>
        q.filters.some((f) => f.op === op && f.column === column && f.value === value);
      expect(has("eq", "is_seed", false), `${q.cols}: is_seed`).toBe(true);
      expect(has("is", "anonymized_at", null), `${q.cols}: anonymized_at`).toBe(true);
      expect(has("eq", "ban_status", "active"), `${q.cols}: ban_status`).toBe(true);
    }
  });

  it("does not send the win-back to a member claimed for a come-back email in the last 20 hours", async () => {
    const fn = await loadConfigured();
    seedOneDripRecipient();
    // Nobody due a drip step; one member due the win-back.
    scenario.reads.profiles!.selectOverrides![0].result = { rows: [] };
    scenario.reads.profiles!.selectOverrides!.push({
      includes: "email, last_drip_at",
      result: { rows: [{ user_id: "user-2", full_name: "Lee", email: "lee@example.com", last_drip_at: null }] },
    });
    scenario.reads.come_back_email_sends = { rows: [{ user_id: "user-2" }] };

    let res = await fn.fetch(cronRequest(fn));
    let b = await body(res);
    expect(res.status).toBe(200);
    expect(b.reEngagement).toBe(0);
    expect(queued()).toHaveLength(0);

    // Control: without the claim the same member IS sent the win-back.
    scenario.reads.come_back_email_sends = { rows: [] };
    res = await fn.fetch(cronRequest(fn));
    b = await body(res);
    expect(b.reEngagement).toBe(1);
  });

  it("ABORTS 503 when the recent come-back list cannot be read — nothing is mailed", async () => {
    const fn = await loadConfigured();
    seedOneDripRecipient();
    scenario.reads.come_back_email_sends = { error: { message: "permission denied" } };

    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(503);
    expect(queued()).toHaveLength(0);
  });

  it("honours the Email MASTER even when Promotions is still on", async () => {
    // Since 20260907032218 the master is its own column and no longer writes
    // `false` across the categories. So master OFF + Promotions ON is the
    // state "mute all email" leaves behind — and this cron used to read only
    // `email_promotions`, which meant the master suppressed notifications but
    // not marketing. Measured 2026-09-07 on the helper test account.
    const fn = await loadConfigured();
    seedOneDripRecipient();
    scenario.reads.notification_preferences = {
      rows: [{ user_id: "user-1", email_promotions: true, email_enabled: false }],
    };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.drip).toBe(0);
    expect(queued()).toHaveLength(0);
  });

  it("does NOT advance the drip cursor when the enqueue fails", async () => {
    // Advancing a cursor over an email that was never queued skips the step
    // silently and forever.
    const fn = await loadConfigured();
    seedOneDripRecipient();
    scenario.rpcErrors = { enqueue_email: { message: "queue unavailable" } };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(b.drip).toBe(0);
    const cursorWrites = scenario.writes.filter(
      (w) => w.table === "profiles" && w.op === "update",
    );
    expect(cursorWrites).toHaveLength(0);
  });

  it("a cursor that does NOT move is a defect, not a send", async () => {
    // The win-back window is measured on `updated_at`, which only a successful
    // profile write advances — so a silently failed cursor re-sends the same
    // commercial email daily for sixteen consecutive days, to someone whose
    // defining characteristic is that they stopped engaging with us.
    const fn = await loadConfigured();
    seedOneDripRecipient();
    scenario.writeSelectRows["profiles"] = [];

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(b.drip).toBe(0);
    expect(String(b.defectReasons)).toContain("cursor NOT advanced");
    expect(String(b.defectReasons)).toContain("will repeat on the next run");
  });

  it("a TRUNCATED recipient list is a defect but does NOT abort the send", async () => {
    // The deliberate asymmetry. A short SUPPRESSION list makes the run mail
    // someone it must not, which is unrecoverable; a short RECIPIENT list makes
    // it skip someone it could have mailed, which tomorrow's run fixes. Still
    // dropped work, so it answers non-2xx — but the people who ARE eligible
    // still get their mail.
    const fn = await loadConfigured();
    seedOneDripRecipient(5000);

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(b.drip).toBe(1);
    expect(queued()).toHaveLength(1);
    expect(String(b.defectReasons)).toContain("read 1 of 5000 rows");
  });

  it("does not drop a failed email_send_log insert", async () => {
    // That row is the only handle the failure path has: when `enqueue_email`
    // fails, the code marks `email_send_log` failed BY `message_id`. If the
    // insert never landed, that UPDATE matches zero rows and the failure is
    // recorded nowhere at all.
    const fn = await loadConfigured();
    seedOneDripRecipient();
    scenario.writeErrors["email_send_log"] = { message: "relation is read only" };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(String(b.defectReasons)).toContain("email_send_log insert failed");
    expect(String(b.defectReasons)).toContain("now untracked");
  });

  describe("the Monday admin digest", () => {
    /** A Monday, so `now.getUTCDay() === 1` and the digest block runs. */
    const A_MONDAY = new Date("2026-08-31T16:22:00Z");

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(A_MONDAY);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function seedAdmin(email = "admin@louisianahelpr.com") {
      seedOneDripRecipient();
      scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
      // The digest reads `profiles` for `email, full_name` — a projection none
      // of the three cohort overrides claim, so it needs its own.
      scenario.reads.profiles.selectOverrides!.push({
        includes: "email, full_name",
        result: { rows: [{ email, full_name: "Admin" }] },
      });
      // OPS-1: ops mail goes only to an admin who is not a test account.
      scenario.rpc.is_test_subject = false;
    }

    it("sends the digest to an admin", async () => {
      const fn = await loadConfigured();
      seedAdmin();

      const b = await body(await fn.fetch(cronRequest(fn)));

      expect(b.adminDigest).toBe(1);
    });

    // Owner 2026-10-12, test mode for test accounts: a test job's platform fee
    // was paid on the Stripe TEST key, so the digest's "Revenue" reads real
    // jobs only.
    // @mutate supabase/functions/engagement-automations/index.ts | .select('platform_fee_amount').eq('status', 'completed').eq('is_seed', false) | .select('platform_fee_amount').eq('status', 'completed')
    it("the digest's revenue read counts real jobs only (never a test-mode fee)", async () => {
      const fn = await loadConfigured();
      seedAdmin();

      await fn.fetch(cronRequest(fn));

      const revenueRead = (scenario.readQueries ?? []).find((q) => q.table === "jobs" && q.cols.includes("platform_fee_amount"));
      expect(revenueRead, "the digest read the jobs' platform fees").toBeDefined();
      expect(revenueRead!.filters).toContainEqual(expect.objectContaining({ op: "eq", column: "is_seed", value: false }));
    });

    // Owner rule (test data never shows to the owner), b29 10-31: the digest's sign-up, posted and completed counts
    // read real members and real jobs only, like its revenue line.
    // @mutate supabase/functions/engagement-automations/index.ts | supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_seed', false).gte('created_at', yesterday), | supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', yesterday),
    // @mutate supabase/functions/engagement-automations/index.ts | supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('is_seed', false).gte('created_at', yesterday), | supabase.from('jobs').select('id', { count: 'exact', head: true }).gte('created_at', yesterday),
    // @mutate supabase/functions/engagement-automations/index.ts | .select('id', { count: 'exact', head: true }).eq('status', 'completed').eq('is_seed', false).gte('updated_at', yesterday) | .select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('updated_at', yesterday)
    it("the digest's sign-up, posted and completed counts leave out test accounts and test jobs", async () => {
      const fn = await loadConfigured();
      seedAdmin();

      await fn.fetch(cronRequest(fn));

      const counts = (scenario.readQueries ?? []).filter((q) => (q.table === "profiles" || q.table === "jobs") && q.cols === "id");
      // Three for the weekly digest; the daily summary (OPS-1) reads its counts from owner_daily_summary_stats.
      expect(counts.map((q) => q.table).sort()).toEqual(["jobs", "jobs", "profiles"]);
      for (const q of counts) expect(q.filters, `${q.table} count`).toContainEqual(expect.objectContaining({ op: "eq", column: "is_seed", value: false }));
    });

    it("HONOURS the suppression list for the admin digest too", async () => {
      // The file's own header says the hard list "applies to EVERY send below,
      // transactional included, because continuing to mail a hard-bounced
      // address is how a sending domain dies." The drip, approval and win-back
      // loops honoured it; this one did not, so a bounced admin address was
      // mailed weekly forever. An admin is not exempt from a mailbox provider.
      const fn = await loadConfigured();
      seedAdmin("bounced-admin@louisianahelpr.com");
      scenario.reads.suppressed_emails = {
        rows: [{ email: "BOUNCED-ADMIN@louisianahelpr.com" }],
      };

      const b = await body(await fn.fetch(cronRequest(fn)));

      expect(b.adminDigest).toBe(0);
      // The drip email in the same run still goes out, so assert on the LABEL
      // rather than the total — the digest specifically must not be queued.
      const digestSends = queued().filter(
        (c) => (c.args as { payload?: { label?: string } })?.payload?.label === "admin_weekly_digest",
      );
      expect(digestSends).toHaveLength(0);
    });

    it("does NOT mail a stat derived from a failed read", async () => {
      // `count || 0` on a failed read put "Pending Approvals: 0" in an
      // administrator's inbox, and administrators act on that — zero pending
      // approvals means nobody opens the queue. The digest is internal ops mail
      // with no deadline, so skipping this week beats publishing a lie.
      const fn = await loadConfigured();
      seedAdmin();
      scenario.reads.reports = { error: { message: "statement timeout" } };

      const res = await fn.fetch(cronRequest(fn));
      const b = await body(res);

      expect(res.status).toBe(500);
      expect(b.adminDigest).toBe(0);
      expect(String(b.defectReasons)).toContain("admin digest NOT sent");
      expect(String(b.defectReasons)).toContain("open reports");
    });
  });

  // ─── OPS-1 (owner 10-29): the owner's daily summary email ─────────────────
  // Every run (the cron is daily). Every count comes from ONE server read, owner_daily_summary_stats
  // (20261031224638), which leaves out is_seed rows and test subjects (proved in
  // src/test/pglite/ownerDailySummaryStats.pglite.mjs); a failed or malformed answer never becomes a zero; it goes
  // ONLY to admins who are not test accounts; and never twice to one admin within 20 hours (review 10-31).
  // @mutate supabase/functions/engagement-automations/index.ts |     if (isTest !== false) continue |     if (isTest === true) continue
  // @mutate supabase/functions/engagement-automations/index.ts |     if (!adminProfile?.email \|\| adminProfile.is_seed === true) continue |     if (!adminProfile?.email) continue
  // @mutate supabase/functions/engagement-automations/index.ts |       if (statsErr) dailyFailures.push | if (false) dailyFailures.push
  // @mutate supabase/functions/engagement-automations/index.ts |       else if (!raw) dailyFailures.push | else if (false) dailyFailures.push
  // @mutate supabase/functions/engagement-automations/index.ts |         if (bad.length) dailyFailures.push | if (false) dailyFailures.push
  // @mutate supabase/functions/engagement-automations/index.ts |       if (dailyFailures.length) { |       if (false) {
  // @mutate supabase/functions/engagement-automations/index.ts | .rpc('owner_daily_summary_stats', { p_since: since }) | .rpc('owner_daily_summary_stats', { p_since: new Date(0).toISOString() })
  // @mutate supabase/functions/engagement-automations/index.ts |           if ((sentRows \|\| []).length > 0) continue | 
  // @mutate supabase/functions/engagement-automations/index.ts |             .not('status', 'in', '(failed,dlq)') | 
  // @mutate supabase/functions/engagement-automations/index.ts |             .gte('created_at', sentSince) | 
  // @mutate supabase/functions/engagement-automations/index.ts | the earlier-send check failed (${sentErr.message})`)\n            continue | the earlier-send check failed (${sentErr.message})`)
  // @mutate supabase/functions/engagement-automations/index.ts |       if (raw && !dailyFailures.length && !Array.isArray(rawSources)) { |       if (false) {
  describe("the owner's daily summary (OPS-1)", () => {
    /** A Tuesday: the weekly digest does not run, the daily summary does. */
    const A_TUESDAY = new Date("2026-09-01T16:22:00Z");
    const STATS = {
      new_users: 4, jobs_posted: 3, items_posted: 5, jobs_completed: 2, items_sold: 2, sales_cents: 3750,
      open_reports: 1, failed_payouts: 0, member_errors: 2, members_with_errors: 1,
      top_sources: [{ source: "facebook", signups: 2 }, { source: "direct", signups: 1 }],
    };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(A_TUESDAY);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function seedOwner(email = "owner@louisianahelpr.com", profile: Record<string, unknown> = {}) {
      seedOneDripRecipient();
      scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
      scenario.reads.profiles.selectOverrides!.push({
        includes: "email, full_name",
        result: { rows: [{ email, full_name: "Owner", is_seed: false, ...profile }] },
      });
      scenario.reads.email_send_log = { rows: [] };
      scenario.rpc.is_test_subject = false;
      scenario.rpc.owner_daily_summary_stats = { ...STATS };
    }

    const dailySends = () =>
      queued().filter((c) => (c.args as { payload?: { label?: string } })?.payload?.label === "owner_daily_summary");
    const dailyStats = () =>
      (emailRenders as Array<{ type: { name: string }; props: { stats: Record<string, unknown> } }>)
        .find((e) => e.type.name === "OwnerDailySummaryEmail")?.props.stats;
    const sendLogCheck = () => (scenario.readQueries ?? []).find((q) => q.table === "email_send_log");

    it("sends the daily summary on a day that is not Monday, with the server's counts", async () => {
      const fn = await loadConfigured();
      seedOwner();

      const b = await body(await fn.fetch(cronRequest(fn)));

      expect(b.ownerDaily).toBe(1);
      expect(b.adminDigest).toBe(0);
      expect(dailySends()).toHaveLength(1);
      expect((dailySends()[0].args as { payload: { to: string; purpose: string } }).payload).toMatchObject({
        to: "owner@louisianahelpr.com",
        purpose: "internal",
      });
      expect(dailyStats()).toEqual({
        newUsers: 4, jobsPosted: 3, itemsPosted: 5, jobsCompleted: 2, itemsSold: 2, salesCents: 3750,
        openReports: 1, failedPayouts: 0, memberErrors: 2, membersWithErrors: 1,
        topSources: [{ source: "facebook", signups: 2 }, { source: "direct", signups: 1 }],
      });
    });

    it("asks the server for exactly the last 24 hours", async () => {
      const fn = await loadConfigured();
      seedOwner();

      await fn.fetch(cronRequest(fn));

      const call = (scenario.rpcCalls ?? []).find((c) => c.name === "owner_daily_summary_stats");
      expect(call?.args).toEqual({ p_since: new Date(A_TUESDAY.getTime() - 24 * 3600_000).toISOString() });
    });

    it("every count comes from the server function that leaves out test subjects, never a table read here", async () => {
      const fn = await loadConfigured();
      seedOwner();

      await fn.fetch(cronRequest(fn));

      // A count read straight from a table here is the is_seed-only read the review found (test accounts counted).
      const tables = ["declutter_items", "declutter_orders", "declutter_payouts", "reports", "error_logs", "member_signup_sources", "test_accounts"];
      const direct = (scenario.readQueries ?? []).filter((q) => tables.includes(q.table));
      expect(direct.map((q) => q.table)).toEqual([]);
      const jobCounts = (scenario.readQueries ?? []).filter((q) => q.table === "jobs");
      expect(jobCounts).toEqual([]);
    });

    it("never goes to a test account, even one with the admin role", async () => {
      const fn = await loadConfigured();
      seedOwner("admin-e2e@louisianahelpr.com");
      scenario.rpc.is_test_subject = true;

      const b = await body(await fn.fetch(cronRequest(fn)));

      expect(b.ownerDaily).toBe(0);
      expect(dailySends()).toHaveLength(0);
    });

    it("an empty test-account answer is not taken as real (only a plain no counts)", async () => {
      const fn = await loadConfigured();
      seedOwner();
      scenario.rpc.is_test_subject = null;

      const b = await body(await fn.fetch(cronRequest(fn)));

      expect(b.ownerDaily).toBe(0);
      expect(dailySends()).toHaveLength(0);
    });

    it("never goes to a seed profile with the admin role", async () => {
      const fn = await loadConfigured();
      seedOwner("seed-admin@louisianahelpr.com", { is_seed: true });

      const b = await body(await fn.fetch(cronRequest(fn)));

      expect(b.ownerDaily).toBe(0);
      expect(dailySends()).toHaveLength(0);
    });

    it("a failed test-account check skips that admin and says so (never mails on a guess)", async () => {
      const fn = await loadConfigured();
      seedOwner();
      scenario.rpcErrors = { is_test_subject: { message: "timeout" } };

      const res = await fn.fetch(cronRequest(fn));
      const b = await body(res);

      expect(b.ownerDaily).toBe(0);
      expect(dailySends()).toHaveLength(0);
      expect(String(b.defectReasons)).toContain("owner daily summary test-account check failed");
    });

    it("does NOT mail when the stats read fails", async () => {
      const fn = await loadConfigured();
      seedOwner();
      scenario.rpcErrors = { owner_daily_summary_stats: { message: "statement timeout" } };

      const res = await fn.fetch(cronRequest(fn));
      const b = await body(res);

      expect(res.status).toBe(500);
      expect(b.ownerDaily).toBe(0);
      expect(dailySends()).toHaveLength(0);
      expect(String(b.defectReasons)).toContain("owner daily summary NOT sent");
      expect(String(b.defectReasons)).toContain("statement timeout");
    });

    it("does NOT mail when the stats answer is empty", async () => {
      const fn = await loadConfigured();
      seedOwner();
      scenario.rpc.owner_daily_summary_stats = null;

      const b = await body(await fn.fetch(cronRequest(fn)));

      expect(b.ownerDaily).toBe(0);
      expect(dailySends()).toHaveLength(0);
      expect(String(b.defectReasons)).toContain("daily stats (no answer)");
    });

    it("does NOT mail a zero for a count missing from the answer", async () => {
      const fn = await loadConfigured();
      seedOwner();
      const partial: Record<string, unknown> = { ...STATS, failed_payouts: "x" };
      delete partial.open_reports;
      scenario.rpc.owner_daily_summary_stats = partial;

      const b = await body(await fn.fetch(cronRequest(fn)));

      expect(b.ownerDaily).toBe(0);
      expect(dailySends()).toHaveLength(0);
      expect(String(b.defectReasons)).toContain("unreadable: open_reports, failed_payouts");
    });

    it("a missing sources list is recorded, and the summary still goes", async () => {
      const fn = await loadConfigured();
      seedOwner();
      const noSources: Record<string, unknown> = { ...STATS };
      delete noSources.top_sources;
      scenario.rpc.owner_daily_summary_stats = noSources;

      const b = await body(await fn.fetch(cronRequest(fn)));

      expect(b.ownerDaily).toBe(1);
      expect(dailyStats()?.topSources).toBeNull();
      expect(String(b.defectReasons)).toContain("sign-up sources left out");
    });

    it("never sends twice: an admin with a daily summary in the last 20 hours that did not fail is skipped", async () => {
      const fn = await loadConfigured();
      seedOwner();
      scenario.reads.email_send_log = { rows: [{ message_id: "earlier" }] };

      const b = await body(await fn.fetch(cronRequest(fn)));

      expect(b.ownerDaily).toBe(0);
      expect(dailySends()).toHaveLength(0);
      const q = sendLogCheck();
      expect(q, "the earlier-send check ran").toBeDefined();
      expect(q!.filters).toEqual(expect.arrayContaining([
        expect.objectContaining({ op: "eq", column: "template_name", value: "owner_daily_summary" }),
        expect.objectContaining({ op: "eq", column: "recipient_email", value: "owner@louisianahelpr.com" }),
        expect.objectContaining({ op: "gte", column: "created_at", value: new Date(A_TUESDAY.getTime() - 20 * 3600_000).toISOString() }),
      ]));
      expect(JSON.stringify(q!.filters)).toContain("(failed,dlq)");
    });

    it("with no earlier send in the window the summary goes", async () => {
      const fn = await loadConfigured();
      seedOwner();

      const b = await body(await fn.fetch(cronRequest(fn)));

      expect(sendLogCheck()).toBeDefined();
      expect(b.ownerDaily).toBe(1);
    });

    it("a failed earlier-send check skips that admin and says so (never risks a double send)", async () => {
      const fn = await loadConfigured();
      seedOwner();
      scenario.reads.email_send_log = { error: { message: "statement timeout" } };

      const b = await body(await fn.fetch(cronRequest(fn)));

      expect(b.ownerDaily).toBe(0);
      expect(dailySends()).toHaveLength(0);
      expect(String(b.defectReasons)).toContain("earlier-send check failed");
    });
  });

  // ─── Owner ruling 2026-10-21 (Q2303, issue #3509) ────────────────────────
  // The welcome series goes ONLY to members who joined in the last 14 days.
  // Older members get no welcome step at all (only the come-back emails, which
  // are a different function). Inside 14 days the steps are unchanged.
  describe("the 14-day welcome window", () => {
    const DAY = 86_400_000;
    function seedSignup(msAgo: number, dripStep = 0) {
      seedOneDripRecipient();
      const row = (scenario.reads.profiles!.selectOverrides![0].result.rows as Record<string, unknown>[])[0];
      row.created_at = new Date(Date.now() - msAgo).toISOString();
      row.drip_step = dripStep;
    }
    async function dripsSent(): Promise<number> {
      const fn = await loadConfigured();
      const res = await fn.fetch(cronRequest(fn));
      expect(res.status).toBe(200);
      const b = await body(res);
      expect(queued()).toHaveLength(b.drip as number);
      return b.drip as number;
    }

    it("a member who joined 13 days ago still gets the step that is due", async () => {
      seedSignup(13 * DAY);
      expect(await dripsSent()).toBe(1);
      expect((emailRenders[0] as { type: { name: string } }).type.name).toBe("WelcomeDripStep1Email");
    });

    it("a member who joined 15 days ago gets no welcome step at all", async () => {
      seedSignup(15 * DAY);
      expect(await dripsSent()).toBe(0);
    });

    it("a member on step 2 who joined 15 days ago does not get step 3", async () => {
      seedSignup(15 * DAY, 2);
      expect(await dripsSent()).toBe(0);
    });

    it("the boundary is 14 days: one minute inside is mailed, one minute past is not", async () => {
      seedSignup(14 * DAY - 60_000, 2);
      expect(await dripsSent()).toBe(1);
      expect((emailRenders[0] as { type: { name: string } }).type.name).toBe("WelcomeDripStep3Email");

      resetSupabaseMock();
      resetEmailMocks();
      seedQuietDay();
      seedSignup(14 * DAY + 60_000, 2);
      expect(await dripsSent()).toBe(0);
    });

    it("the drip-recipient READ itself asks only for members who joined in the last 14 days", async () => {
      seedSignup(2 * DAY);
      await dripsSent();
      const dripReads = (scenario.readQueries ?? []).filter(
        (q) => q.table === "profiles" && /drip_step/.test(q.cols ?? "") && q.filters.some((f) => f.op === "lt" && f.column === "drip_step"),
      );
      // Inventory floor: the drip scan was found (a renamed column would
      // otherwise make the loop below check nothing).
      expect(dripReads.length).toBeGreaterThan(0);
      for (const q of dripReads) {
        const since = q.filters.find((f) => f.op === "gte" && f.column === "created_at")?.value as string | undefined;
        expect(since, "drip read filters created_at >= 14 days ago").toBeDefined();
        const days = (Date.now() - new Date(since!).getTime()) / DAY;
        expect(days).toBeGreaterThan(13.999);
        expect(days).toBeLessThan(14.001);
      }
    });
  });

  it("PAGES both consent lists past the 1000-row cap", async () => {
    const fn = await loadConfigured();
    seedOneDripRecipient();
    // 1,200 suppressed addresses, one of which is our recipient's — beyond the
    // cap, so an unpaged read would have stopped before reaching them.
    const suppressed = Array.from({ length: 1200 }, (_, i) => ({ email: `x${i}@example.com` }));
    suppressed[1100] = { email: "dana@example.com" };
    scenario.reads.suppressed_emails = { rows: suppressed, count: 1200 };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.drip).toBe(0);
    expect(queued()).toHaveLength(0);
  });
});

// ─── proven able to fail, 2026-09-21 ───────────────────────────────────────
// Drop `email_enabled` from the opt-out predicate and the Email MASTER stops
// muting marketing — the exact 2026-09-07 defect. Red:
//   × honours the Email MASTER even when Promotions is still on
//   AssertionError: expected 1 to be +0
// This is the SEND site, executed: b.drip and the enqueue_email calls, not a
// write payload.
// @mutate supabase/functions/engagement-automations/index.ts | p.email_promotions === false \|\| p.email_enabled === false | p.email_promotions === false
