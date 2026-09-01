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
import { resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret";

/** Captures what would have been POSTed to Slack. */
let slackPosts: Array<Record<string, any>>;

async function load(): Promise<EdgeHarness> {
  setEnv({
    CRON_SECRET,
    SLACK_API_KEY: "xoxb-test",
    SLACK_OPS_CHANNEL: "#ops-alerts",
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
        severity: "info",
        title: "t",
        message: "m",
      }),
    );

    expect(slackPosts[0].attachments[0].color).toBe("#3b82f6");
  });
});
