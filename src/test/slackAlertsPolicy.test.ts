/**
 * postSlackOpsAlert (supabase/functions/_shared/slack-alerts.ts) under the
 * 2026-09-14 severity policy. The edge harness mocks this module away, so it is
 * exercised directly here with a stubbed Deno.env and fetch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const WEBHOOK = "https://hooks.slack.test/T/B/x";
const SUPA = "https://proj.supabase.test";

type Call = { url: string; init?: RequestInit };
let calls: Call[];
let firstRowId: string | null;
let lookupFails: boolean;
/** How many alerts of this kind the hourly-cap read should report. */
let postsThisHour: number;
/** What Slack answers the POST with. 429 is what a flooded webhook really sends. */
let slackStatus: number;

function install() {
  const env: Record<string, string> = { SLACK_WEBHOOK_URL: WEBHOOK, SUPABASE_URL: SUPA, SECRET_KEY: "svc" };
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] } };
  let n = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith(`${SUPA}/rest/v1/error_logs?select=id`) && init?.method === "POST") {
        n += 1;
        return new Response(JSON.stringify([{ id: `row-${n}` }]), { status: 201 });
      }
      // The hourly-cap read, distinguished by its tags->>kind filter.
      if (url.startsWith(`${SUPA}/rest/v1/error_logs?`) && decodeURIComponent(url).includes("tags->>kind")) {
        if (lookupFails) return new Response("nope", { status: 500 });
        return new Response(
          JSON.stringify(Array.from({ length: postsThisHour }, (_, i) => ({ id: `hour-${i}` }))),
          { status: 200 },
        );
      }
      if (url.startsWith(`${SUPA}/rest/v1/error_logs?`)) {
        if (lookupFails) return new Response("nope", { status: 500 });
        return new Response(JSON.stringify(firstRowId ? [{ id: firstRowId }] : []), { status: 200 });
      }
      if (url === WEBHOOK) return new Response(slackStatus === 200 ? "ok" : "ratelimited", { status: slackStatus });
      return new Response("ok", { status: 200 });
    }),
  );
}

const slackPosts = () => calls.filter((c) => c.url === WEBHOOK);
const rowInserts = () => calls.filter((c) => c.url.includes("/rest/v1/error_logs") && c.init?.method === "POST");
const rowPatches = () => calls.filter((c) => c.url.includes("/rest/v1/error_logs") && c.init?.method === "PATCH");

async function post(input: Record<string, unknown>) {
  // A computed specifier keeps tsc from type-checking a Deno module (it has no
  // `Deno` global); vitest still runs the real file.
  const modulePath = "../../supabase/functions/_shared/slack-alerts";
  const { postSlackOpsAlert } = await import(/* @vite-ignore */ modulePath);
  await postSlackOpsAlert({ kind: "custom", title: "T", message: "M", ...input } as any);
}

describe("postSlackOpsAlert severity policy", () => {
  beforeEach(() => {
    calls = [];
    firstRowId = null;
    lookupFails = false;
    postsThisHour = 0;
    slackStatus = 200;
    install();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any).Deno;
  });

  it("a critical alert posts to Slack", async () => {
    await post({ severity: "critical" });
    expect(slackPosts()).toHaveLength(1);
  });

  it("a money kind posts even when the call site says warning (kind floor)", async () => {
    await post({ kind: "money_at_risk", severity: "warning" });
    await post({ kind: "payout_failed", severity: "warning" });
    expect(slackPosts()).toHaveLength(2);
  });

  it("a warning POSTS and is still recorded — the row is the durable half", async () => {
    // Reversed 2026-09-22: warning used to wait for send_ops_daily_digest,
    // which is a cron, and which died in that morning's startup-timeout outage
    // along with the report of the outage. Volume is now held down by
    // SLACK_THROTTLE_MINUTES per source, not by dropping a tier.
    // The error_logs row is unchanged and still written: Slack is the
    // notification, the row is the record.
    await post({ severity: "warning" });
    expect(slackPosts()).toHaveLength(1);
    expect(rowInserts()).toHaveLength(1);
    const row = JSON.parse(String(rowInserts()[0].init!.body));
    expect(row.severity).toBe("warning");
    expect(row.tags.source).toBe("ops-alert");
  });

  it("oncePerDayKey: the first row of the day posts", async () => {
    firstRowId = "row-1";
    await post({ severity: "critical", oncePerDayKey: "admin-push:dispute split did not settle" });
    expect(slackPosts()).toHaveLength(1);
    // Recorded as 'error', never 'critical', so the error_logs trigger cannot post it again.
    expect(JSON.parse(String(rowInserts()[0].init!.body)).severity).toBe("error");
  });

  it("oncePerDayKey: a second admin's copy of the same event does not post", async () => {
    firstRowId = "row-from-another-admin";
    await post({ severity: "critical", oncePerDayKey: "admin-push:dispute split did not settle" });
    expect(slackPosts()).toHaveLength(0);
    expect(rowInserts()).toHaveLength(1);
  });

  it("oncePerDayKey fails OPEN: if the dedupe read fails, the critical alert still posts", async () => {
    lookupFails = true;
    await post({ severity: "critical", oncePerDayKey: "k" });
    expect(slackPosts()).toHaveLength(1);
  });
});

/**
 * The once-per-day token is claimed BEFORE the Slack POST, because the row has
 * to exist for "earliest row of the day wins" to be decidable. So a post that
 * then fails would suppress every retry for the rest of the UTC day.
 *
 * That is not theoretical for a support request: `supportRequestKey` is derived
 * from the message text, so a sender who sees nothing happen and re-sends the
 * same words produces the SAME key. Before the fix, Slack answering 429 once
 * meant the request never reached #ops-alerts that day and the log line said
 * it already had.
 *
 * RED before the fix: no PATCH is issued and the retry is suppressed — both
 * assertions in the first case below fail.
 */
describe("postSlackOpsAlert: a failed post must not burn the day's token", () => {
  beforeEach(() => {
    calls = [];
    firstRowId = null;
    lookupFails = false;
    postsThisHour = 0;
    slackStatus = 200;
    install();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any).Deno;
  });

  it("Slack answering 429 releases the key, so the sender's retry still posts", async () => {
    slackStatus = 429;
    await post({ kind: "support_request", severity: "info", oncePerDayKey: "support-request:abcd1234" });
    expect(slackPosts()).toHaveLength(1);
    // The key is given up: the row stays for the digest, its alert_key does not.
    expect(rowPatches()).toHaveLength(1);
    const released = JSON.parse(String(rowPatches()[0].init!.body));
    expect(released.tags.alert_key).toBeUndefined();
    expect(released.tags.undelivered_alert_key).toBe("support-request:abcd1234");

    // The retry: the released row is no longer the earliest row holding the key.
    calls = [];
    slackStatus = 200;
    await post({ kind: "support_request", severity: "info", oncePerDayKey: "support-request:abcd1234" });
    expect(slackPosts()).toHaveLength(1);
    expect(rowPatches()).toHaveLength(0);
  });

  it("a Slack POST that throws releases the key too", async () => {
    (globalThis.fetch as any).mockImplementationOnce?.(undefined);
    const realFetch = globalThis.fetch as any;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === WEBHOOK) throw new Error("network down");
      return realFetch(url, init);
    }));
    await post({ kind: "support_request", severity: "info", oncePerDayKey: "support-request:deadbeef" });
    expect(rowPatches()).toHaveLength(1);
    expect(JSON.parse(String(rowPatches()[0].init!.body)).tags.undelivered_alert_key).toBe("support-request:deadbeef");
  });

  it("no transport configured releases the key rather than pretending it posted", async () => {
    const env: Record<string, string> = { SUPABASE_URL: SUPA, SECRET_KEY: "svc" }; // no SLACK_WEBHOOK_URL
    (globalThis as any).Deno = { env: { get: (k: string) => env[k] } };
    await post({ kind: "support_request", severity: "info", oncePerDayKey: "support-request:cafe" });
    expect(slackPosts()).toHaveLength(0);
    expect(rowPatches()).toHaveLength(1);
  });

  it("a successful post keeps the key, so a same-day duplicate is still suppressed", async () => {
    await post({ kind: "support_request", severity: "info", oncePerDayKey: "support-request:aaaa" });
    expect(slackPosts()).toHaveLength(1);
    expect(rowPatches()).toHaveLength(0);
    calls = [];
    firstRowId = "row-1"; // the earlier row still holds the key
    await post({ kind: "support_request", severity: "info", oncePerDayKey: "support-request:aaaa" });
    expect(slackPosts()).toHaveLength(0);
  });
});

/**
 * `support_request` is reachable from an UNAUTHENTICATED form, and its dedupe
 * key is content-derived — changing one character is a new key, so the
 * per-request dedupe is no ceiling at all. contact-support's own limit is 5 per
 * IP per 15 minutes, i.e. ~480 posts a day from one address, which would bury
 * the critical pages this channel exists for.
 *
 * RED before the fix: no cap exists, so the 13th post goes to Slack.
 */
describe("postSlackOpsAlert: non-critical always-post kinds have an hourly ceiling", () => {
  beforeEach(() => {
    calls = [];
    firstRowId = null;
    lookupFails = false;
    postsThisHour = 0;
    slackStatus = 200;
    install();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any).Deno;
  });

  it("under the cap it posts", async () => {
    postsThisHour = 11;
    await post({ kind: "support_request", severity: "info" });
    expect(slackPosts()).toHaveLength(1);
  });

  it("at the cap it is recorded for the digest instead of posted", async () => {
    postsThisHour = 12;
    await post({ kind: "support_request", severity: "info" });
    expect(slackPosts()).toHaveLength(0);
    expect(rowInserts()).toHaveLength(1);
    expect(JSON.parse(String(rowInserts()[0].init!.body)).tags.capped).toBe("hourly");
  });

  it("a CRITICAL alert is never capped, however loud the hour has been", async () => {
    postsThisHour = 500;
    await post({ kind: "money_at_risk", severity: "warning" });
    await post({ severity: "critical" });
    expect(slackPosts()).toHaveLength(2);
  });

  it("the cap read fails OPEN: a support request is never silenced by a broken read", async () => {
    lookupFails = true;
    await post({ kind: "support_request", severity: "info" });
    expect(slackPosts()).toHaveLength(1);
  });
});

// Proof this guard can fail: lift the hourly ceiling and an unauthenticated
// support form can bury the critical pages this channel exists for.
// @mutate supabase/functions/_shared/slack-alerts.ts | const ALWAYS_POST_HOURLY_CAP = 12 | const ALWAYS_POST_HOURLY_CAP = 100000
