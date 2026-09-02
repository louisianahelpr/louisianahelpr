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
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetEmailMocks, emailRenders } from "./mocks/email";

const CRON_SECRET = "cron-secret";

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
    }

    it("sends the digest to an admin", async () => {
      const fn = await loadConfigured();
      seedAdmin();

      const b = await body(await fn.fetch(cronRequest(fn)));

      expect(b.adminDigest).toBe(1);
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
