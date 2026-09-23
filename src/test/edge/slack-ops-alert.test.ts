/**
 * Unit tests for the `slack-ops-alert` Supabase edge function.
 *
 * This is the ONLY channel every automated watcher in the database has. Eight
 * SQL functions post here through `net.http_post` — the cron-HTTP-failure
 * watcher, the silent-cron detector, the stopped-cron detector, the stranded
 * instant-payout reaper, the subscription-linkage watcher and the cron SQL
 * error reporter among them.
 *
 * Not one of those eight sends `kind`, and the handler required it. Verified
 * 2026-09-01 by reading all eight `jsonb_build_object` bodies in
 * supabase/migrations: every one sends exactly `title`, `message` and
 * `severity`. So every watcher alert this platform has ever tried to raise was
 * answered `400 {"error":"kind, title, and message are required"}` and no
 * message reached the ops channel.
 *
 * Six of the eight also send `'severity': 'error'`, which is not a member of
 * AlertSeverity — so `SEVERITY_ICON[severity]` and `SEVERITY_COLOR[severity]`
 * were both `undefined` and the Slack text would have read
 * "undefined 3 cron HTTP failure(s)" with an invalid attachment colour, on the
 * runs that got past the 400 (i.e. none of them).
 *
 * The tests below encode the WATCHER'S body shape, not an idealised one, so
 * they fail if the contract ever narrows back to something the callers do not
 * send.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { resetSupabaseMock, scenario } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret";

/** Captures what would have been POSTed to Slack. */
let slackPosts: Array<Record<string, any>>;

async function load(): Promise<EdgeHarness> {
  setEnv({
    CRON_SECRET,
    SLACK_API_KEY: "xoxb-test",
    SLACK_OPS_CHANNEL: "#ops-alerts",
    // The delivery-failure path builds a service-role client to record the
    // undelivered alert in error_logs — without these it would build one
    // against empty strings, which is not what production does.
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  });
  return loadEdgeFunction("slack-ops-alert");
}

/**
 * The EXACT body every SQL watcher sends — see e.g.
 * 20260828010000_cron_http_failure_watcher.sql:117-121. No `kind`, and a
 * `severity` outside the union.
 */
function watcherBody() {
  return {
    title: "3 cron HTTP failure(s) in the last hour",
    message: "Affected: auto-release-payment. Details in error_logs (tags.source = cron-http).",
    severity: "error",
  };
}

function call(fn: EdgeHarness, body: unknown) {
  return fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body });
}

async function json(res: Response): Promise<Record<string, any>> {
  return JSON.parse(await res.text());
}

describe("slack-ops-alert — the contract the SQL watchers actually speak", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEnv();
    slackPosts = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        slackPosts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true, ts: "1.0" }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ACCEPTS a watcher body with no `kind` and posts to Slack", async () => {
    const fn = await load();
    const res = await fn.fetch(call(fn, watcherBody()));

    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true });
    expect(slackPosts).toHaveLength(1);
  });

  it("renders a real icon for the watchers' out-of-union `severity: 'error'`", async () => {
    // The tell for the old behaviour is the literal string "undefined" at the
    // head of the Slack text, from `SEVERITY_ICON['error']`.
    const fn = await load();
    await fn.fetch(call(fn, watcherBody()));

    expect(slackPosts[0].text).not.toContain("undefined");
    expect(slackPosts[0].text).toContain("3 cron HTTP failure(s) in the last hour");
    // 'error' means critical — an alert whose severity we cannot read is never
    // quietly downgraded.
    expect(slackPosts[0].attachments[0].color).toBe("#dc2626");
  });

  it("still rejects a body with no title or no message", async () => {
    // The relaxation is scoped: an alert with no text is not an alert.
    const fn = await load();
    for (const bad of [
      { message: "no title", severity: "error" },
      { title: "no message", severity: "error" },
    ]) {
      const res = await fn.fetch(call(fn, bad));
      expect(res.status).toBe(400);
    }
    expect(slackPosts).toHaveLength(0);
  });

  it("still refuses an unauthenticated caller — the endpoint is not spammable", async () => {
    const fn = await load();
    const res = await fn.fetch(
      fn.request({ headers: { Authorization: "Bearer wrong" }, body: watcherBody() }),
    );

    expect(res.status).toBe(401);
    expect(slackPosts).toHaveLength(0);
  });

  it("honours an explicit kind and severity when a caller does send them", async () => {
    const fn = await load();
    await fn.fetch(
      call(fn, {
        kind: "payout_failed",
        severity: "critical",
        title: "t",
        message: "m",
      }),
    );

    expect(slackPosts[0].attachments[0].color).toBe("#dc2626");
  });
});

/**
 * Severity policy (2026-09-14, _shared/alertPolicy.ts): #ops-alerts carries
 * only CRITICAL items plus one daily digest. Before this, every error_logs row
 * posted, the channel hit Slack's rate limit, and each `ratelimited` refusal
 * was logged as a new row that posted again.
 */
describe("slack-ops-alert — every severity posts, with its own icon and colour", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEnv();
    slackPosts = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        slackPosts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true, ts: "1.0" }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * REVERSED 2026-09-22, deliberately. These three used to assert
   * `skipped: "digest"` — warning and info never posted, they waited for
   * `send_ops_daily_digest`.
   *
   * That digest IS A CRON (`ops-daily-digest`, 14:40 UTC). When pg_cron
   * refused to start 457 jobs that morning it was one of the nine daily jobs
   * that never ran, so the outage was reported at 'error', routed to the
   * digest, and the digest was part of the outage. Nine hours, nobody told.
   *
   * Owner: "I feel like medium and low alerts should show in slack also so
   * that can be fixed." Volume is now held down by SLACK_THROTTLE_MINUTES in
   * the SQL trigger (one post per source per severity-dependent window), not
   * by dropping whole tiers — a dropped severity is indistinguishable from a
   * healthy system.
   *
   * A missing severity still normalises to 'warning' (`normalizeSeverity`),
   * which is why `undefined` belongs in this list and posts amber.
   */
  for (const [severity, colour] of [["warning", "#f59e0b"], ["info", "#3b82f6"], [undefined, "#f59e0b"]] as const) {
    it(`posts severity ${String(severity)} with its own colour, not dressed as critical`, async () => {
      const fn = await load();
      const res = await fn.fetch(call(fn, { title: "t", message: "m", severity }));
      expect(res.status).toBe(200);
      expect(await json(res)).toMatchObject({ ok: true });
      expect(slackPosts).toHaveLength(1);
      // The tier has to stay legible: a page must still look different from a
      // notice, or routing everything here would just make everything urgent.
      expect(slackPosts[0].attachments[0].color).toBe(colour);
    });
  }

  it("posts the daily digest even though it is info severity", async () => {
    const fn = await load();
    await fn.fetch(
      call(fn, { kind: "digest", severity: "info", title: "Daily ops digest: 3 event(s) in 24h", message: "..." }),
    );
    expect(slackPosts).toHaveLength(1);
    expect(slackPosts[0].attachments[0].color).toBe("#3b82f6");
  });
});

/**
 * THE ALARM MUST NOT FAIL SILENTLY.
 *
 * Every caller is a fire-and-forget `net.http_post` from SQL: it cannot read
 * the response body, cannot retry, and this function answers HTTP 200 whatever
 * happens — deliberately, so a Slack outage never becomes the reason a dispute
 * or a payout errors. That design makes a REJECTED post indistinguishable from
 * a delivered one at the call site, in the one component whose entire job is to
 * tell a human that something is broken. `channel_not_found` is the realistic
 * one: #ops-alerts is private, so chat.postMessage refuses until the bot is
 * invited, and nothing anywhere would have said so.
 *
 * So the non-throwing 200 stays, and the failure is required to leave a durable
 * trace in `error_logs` instead. Added 2026-09-21 after a mutation run: deleting
 * the whole `if (!res.ok || data?.ok === false)` branch from the function left
 * this file GREEN — nothing here had ever exercised a Slack rejection, so the
 * swallow-detection was unproven in exactly the way this module cannot afford.
 */
describe("slack-ops-alert — a REJECTED post is recorded, never swallowed", () => {
  /** Whatever Slack answers for this test's post. */
  let slackReply: { status: number; body: Record<string, unknown> };

  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEnv();
    slackPosts = [];
    slackReply = { status: 200, body: { ok: true, ts: "1.0" } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        slackPosts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(slackReply.body), { status: slackReply.status });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const errorLogInserts = () =>
    scenario.writes.filter((w) => w.table === "error_logs" && w.op === "insert");

  it("records an application-level rejection (ok:false) in error_logs and reports ok:false", async () => {
    slackReply = { status: 200, body: { ok: false, error: "channel_not_found" } };
    const fn = await load();
    const res = await fn.fetch(call(fn, { kind: "payout_failed", severity: "critical", title: "t", message: "m" }));

    // It DID try to post — this is a rejection, not a skip.
    expect(slackPosts).toHaveLength(1);
    // Still 200: a SQL caller must never see this as its own failure.
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: false, error: "channel_not_found" });

    const logged = errorLogInserts();
    expect(logged).toHaveLength(1);
    const payload = logged[0].payload as Record<string, any>;
    expect(String(payload.message)).toContain("channel_not_found");
    // 'error', never 'critical': trg_error_logs_slack must not post this row,
    // or a ratelimited Slack feeds itself (616 rows in three days, 2026-09-14).
    expect(payload.severity).toBe("error");
    expect(JSON.parse(String(payload.stack))).toMatchObject({
      slack_error: "channel_not_found",
      alert_kind: "payout_failed",
    });
  });

  it("records an HTTP-level rejection (non-2xx) the same way", async () => {
    slackReply = { status: 500, body: { error: "server_error" } };
    const fn = await load();
    const res = await fn.fetch(call(fn, { kind: "payout_failed", severity: "critical", title: "t", message: "m" }));

    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: false, error: "server_error" });
    expect(errorLogInserts()).toHaveLength(1);
  });

  it("writes NOTHING to error_logs when the post actually lands", async () => {
    // The floor under the two assertions above: if every run logged, the
    // presence of a row would prove nothing about delivery.
    const fn = await load();
    const res = await fn.fetch(call(fn, { kind: "payout_failed", severity: "critical", title: "t", message: "m" }));

    expect(await json(res)).toMatchObject({ ok: true });
    expect(errorLogInserts()).toHaveLength(0);
  });
});

// ── Shown able to fail ─────────────────────────────────────────────────────
// The whole Slack-rejection branch. Deleting it makes every refused post
// (revoked token, renamed channel, bot never invited to the private
// #ops-alerts) answer `{ok:true}` and leave no trace anywhere — the alarm
// itself failing silently. Measured 2026-09-21: before the
// "a REJECTED post is recorded, never swallowed" block above, this mutation
// left the file GREEN.
// @mutate supabase/functions/slack-ops-alert/index.ts | if (!res.ok \|\| data?.ok === false) { | if (false) {
