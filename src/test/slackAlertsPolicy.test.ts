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
      if (url.startsWith(`${SUPA}/rest/v1/error_logs?`)) {
        if (lookupFails) return new Response("nope", { status: 500 });
        return new Response(JSON.stringify(firstRowId ? [{ id: firstRowId }] : []), { status: 200 });
      }
      return new Response("ok", { status: 200 });
    }),
  );
}

const slackPosts = () => calls.filter((c) => c.url === WEBHOOK);
const rowInserts = () => calls.filter((c) => c.url.includes("/rest/v1/error_logs") && c.init?.method === "POST");

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

  it("a warning does not post; it is recorded (non-critical) for the digest", async () => {
    await post({ severity: "warning" });
    expect(slackPosts()).toHaveLength(0);
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
