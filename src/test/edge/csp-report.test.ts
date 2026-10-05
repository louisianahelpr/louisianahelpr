/**
 * GUARD (2026-10-05, owner-approved hardening): csp-report turns a browser's
 * Content-Security-Policy violation report into ONE error_logs row that can
 * never page Slack, and nothing else.
 *
 * Runs the REAL function source (supabase/functions/csp-report/index.ts and
 * its report.ts) through the edge harness. What it pins:
 *   - both report shapes (report-uri's application/csp-report and the
 *     Reporting API's application/reports+json) insert one row with source
 *     'csp', severity 'warning', the URL stripped of its query string;
 *   - the insert runs on the PUBLISHABLE key's client, never the service
 *     role's: stamp_error_log_origin keys origin on current_user, so this is
 *     what makes the row origin 'client' (no Slack page, no muted server page);
 *   - browser-extension and about:/data: noise is dropped before any database
 *     call (no rate-limit hit, no insert);
 *   - a body over 64 KB is refused with 413 and never parsed, and a real
 *     4-entry Reporting API batch (each entry carrying originalPolicy) is
 *     stored, not refused (lh-authz-rls review: an 8 KB cap dropped it);
 *   - a blocked-uri that is neither a URL nor a CSP keyword (Slack mrkdwn) is
 *     stored as "(invalid)";
 *   - the per-IP limit answers 429 before the insert.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { resetSupabaseMock, scenario } from "./mocks/supabase";
import { resetSharedMocks, rateLimitState, rateLimitCalls } from "./mocks/shared";
import { resetStripeMock } from "./mocks/stripe";

const ANON = "publishable-key";
const SERVICE = "service-key";

async function load(): Promise<EdgeHarness> {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, PUBLISHABLE_KEY: ANON });
  return loadEdgeFunction("csp-report");
}

const legacy = (over: Record<string, unknown> = {}) => ({
  "csp-report": {
    "document-uri": "https://louisianahelpr.com/reset-password?token=SECRET#frag",
    "blocked-uri": "https://evil.example/x.js?q=1",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "original-policy": "default-src 'self'",
    disposition: "enforce",
    "source-file": "https://louisianahelpr.com/assets/index.js",
    "line-number": 12,
    "column-number": 4,
    "status-code": 200,
    ...over,
  },
});

const reportingApi = (body: Record<string, unknown>) => [
  { type: "deprecation", url: "https://louisianahelpr.com/", body: { id: "x" } },
  {
    type: "csp-violation",
    age: 10,
    url: "https://louisianahelpr.com/jobs?x=1",
    user_agent: "UA",
    body: {
      documentURL: "https://louisianahelpr.com/jobs?x=1",
      blockedURL: "https://cdn.bad.example/a.js",
      effectiveDirective: "script-src-elem",
      disposition: "enforce",
      sourceFile: "https://louisianahelpr.com/assets/index.js",
      lineNumber: 3,
      columnNumber: 9,
      statusCode: 200,
      sample: "",
      ...body,
    },
  },
];

function post(fn: EdgeHarness, payload: unknown, contentType = "application/csp-report", extra: Record<string, string> = {}) {
  return fn.fetch(
    fn.request({
      method: "POST",
      headers: { "content-type": contentType, "user-agent": "Mozilla/5.0 test", ...extra },
      rawBody: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );
}

const inserts = () => scenario.writes.filter((w) => w.table === "error_logs" && w.op === "insert");

describe("csp-report", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
  });

  it("a real report-uri violation inserts ONE warning row, source csp, as the publishable key", async () => {
    const fn = await load();
    const res = await post(fn, legacy());
    expect(res.status).toBe(204);
    const rows = inserts();
    expect(rows).toHaveLength(1);
    const row = rows[0].payload as Record<string, unknown>;
    expect(row.severity).toBe("warning");
    expect(row.tags).toMatchObject({ source: "csp", directive: "script-src-elem", blocked: "https://evil.example/x.js" });
    expect(row.message).toBe("CSP violation: script-src-elem blocked https://evil.example/x.js");
    // The reset token never reaches error_logs.
    expect(row.url).toBe("https://louisianahelpr.com/reset-password");
    expect(JSON.stringify(row)).not.toContain("SECRET");
    expect(row.user_agent).toBe("Mozilla/5.0 test");
    expect(row).not.toHaveProperty("user_id");
    // Origin 'client' comes from the role the insert runs as: the publishable key.
    const keys = (scenario.clients ?? []).map((c) => c.key);
    expect(keys).toContain(ANON);
    expect(keys).not.toContain(SERVICE);
    expect(rateLimitCalls).toEqual([expect.objectContaining({ keyPrefix: "csp-report", maxRequests: 20 })]);
  });

  it("a Reporting API batch (application/reports+json) inserts ONE row from its csp-violation entries", async () => {
    const fn = await load();
    const res = await post(fn, reportingApi({}), "application/reports+json");
    expect(res.status).toBe(204);
    const rows = inserts();
    expect(rows).toHaveLength(1);
    const row = rows[0].payload as Record<string, unknown>;
    expect(row.tags).toMatchObject({ source: "csp", blocked: "https://cdn.bad.example/a.js" });
    expect(row.url).toBe("https://louisianahelpr.com/jobs");
    expect(row.context).toMatchObject({ report_count: 1, noise_dropped: 0 });
  });

  it.each([
    ["moz-extension", "moz-extension://abc/content.js"],
    ["chrome-extension", "chrome-extension://abc/inject.js"],
    ["safari-extension", "safari-extension://abc/x.js"],
    ["about:", "about:blank"],
    ["data:", "data:text/javascript,alert(1)"],
    ["bare data keyword", "data"],
  ])("drops %s noise before any database call", async (_label, blocked) => {
    const fn = await load();
    const res = await post(fn, legacy({ "blocked-uri": blocked }));
    expect(res.status).toBe(204);
    expect(inserts()).toHaveLength(0);
    expect(rateLimitCalls).toHaveLength(0);
  });

  it("drops a violation whose source file is an extension's", async () => {
    const fn = await load();
    await post(fn, legacy({ "blocked-uri": "inline", "source-file": "chrome-extension://abc/cs.js" }));
    expect(inserts()).toHaveLength(0);
  });

  it("stores a real Reporting API batch of 5 entries, each with its originalPolicy (~10 KB)", async () => {
    const fn = await load();
    const policy = "default-src 'self'; script-src 'self' " + "'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' ".repeat(30);
    const entry = (i: number) => ({
      type: "csp-violation", age: i, url: "https://louisianahelpr.com/jobs", user_agent: "UA",
      body: {
        documentURL: "https://louisianahelpr.com/jobs", blockedURL: `https://cdn.bad.example/${i}.js`,
        effectiveDirective: "script-src-elem", disposition: "enforce", originalPolicy: policy,
        sourceFile: "https://louisianahelpr.com/assets/index.js", lineNumber: i, columnNumber: 1, statusCode: 200, sample: "",
      },
    });
    const batch = [0, 1, 2, 3, 4].map(entry);
    const bytes = new TextEncoder().encode(JSON.stringify(batch)).length;
    expect(bytes).toBeGreaterThan(8 * 1024);
    const res = await post(fn, batch, "application/reports+json");
    expect(res.status).toBe(204);
    const rows = inserts();
    expect(rows).toHaveLength(1);
    expect((rows[0].payload as { context: unknown }).context).toMatchObject({ report_count: 5 });
  });

  it("a blocked-uri that is not a URL or a CSP keyword is stored as (invalid), never verbatim", async () => {
    const fn = await load();
    await post(fn, legacy({ "blocked-uri": "<!channel> <https://phish.example|click>" }));
    await post(fn, legacy({ "blocked-uri": "inline" }));
    const [bad, kw] = inserts().map((r) => r.payload as { message: string; tags: { blocked: string } });
    expect(bad.tags.blocked).toBe("(invalid)");
    expect(bad.message).not.toContain("<!channel>");
    expect(kw.tags.blocked).toBe("inline");
  });

  it("a directive that is not a directive name is dropped from the row", async () => {
    const fn = await load();
    await post(fn, legacy({ "effective-directive": "<!here>", "violated-directive": "<!here>" }));
    const row = inserts()[0].payload as { message: string; tags: { directive: string } };
    expect(row.tags.directive).toBe("(unknown)");
    expect(row.message).not.toContain("<!here>");
  });

  it("refuses a body over 64 KB with 413 and inserts nothing", async () => {
    const fn = await load();
    const big = legacy({ "script-sample": "x".repeat(70_000) });
    const res = await post(fn, big);
    expect(res.status).toBe(413);
    expect(inserts()).toHaveLength(0);
    expect(rateLimitCalls).toHaveLength(0);
  });

  it("refuses a declared Content-Length over 64 KB before reading", async () => {
    const fn = await load();
    const res = await post(fn, legacy(), "application/csp-report", { "content-length": "70000" });
    expect(res.status).toBe(413);
    expect(inserts()).toHaveLength(0);
  });

  it("answers 429 over the per-IP limit and inserts nothing", async () => {
    rateLimitState.allowed = false;
    const fn = await load();
    const res = await post(fn, legacy());
    expect(res.status).toBe(429);
    expect(inserts()).toHaveLength(0);
  });

  it("refuses a non-report body and a non-report content type", async () => {
    const fn = await load();
    expect((await post(fn, "not json")).status).toBe(400);
    expect((await post(fn, { hello: 1 })).status).toBe(400);
    expect((await post(fn, legacy(), "text/plain")).status).toBe(415);
    expect(inserts()).toHaveLength(0);
  });

  it("answers the Reporting API preflight and refuses GET", async () => {
    const fn = await load();
    const pre = await fn.fetch(fn.request({ method: "OPTIONS" }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(pre.headers.get("Access-Control-Allow-Headers") ?? "").toContain("content-type");
    expect((await fn.fetch(fn.request({ method: "GET" }))).status).toBe(405);
  });

  it("a failed insert is a 500, not a silent 204", async () => {
    scenario.writeErrors = { error_logs: { message: "boom" } };
    const fn = await load();
    expect((await post(fn, legacy())).status).toBe(500);
  });
});

// ── Shown able to fail ─────────────────────────────────────────────────────
// Service-role insert: the row would be stamped origin 'server' and page Slack.
// @mutate supabase/functions/csp-report/index.ts | const publishableKey = Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"); | const publishableKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
// Extension noise kept.
// @mutate supabase/functions/csp-report/index.ts | const kept = parsed.violations.filter((v) => !isNoise(v)); | const kept = parsed.violations;
// No size limit.
// @mutate supabase/functions/csp-report/index.ts |     if (total > max) { |     if (false) {
// The 8 KB cap back (drops real batches).
// @mutate supabase/functions/csp-report/report.ts | export const MAX_BODY_BYTES = 64 * 1024; | export const MAX_BODY_BYTES = 8 * 1024;
// An unparsable blocked-uri kept verbatim.
// @mutate supabase/functions/csp-report/report.ts | return BLOCKED_KEYWORD.test(bare) ? bare : "(invalid)"; | return bare;
// Any text accepted as a directive.
// @mutate supabase/functions/csp-report/report.ts | return /^[a-z-]{1,60}$/.test(d) ? d : ""; | return d;
// The rate limit gone.
// @mutate supabase/functions/csp-report/index.ts | if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders); |
// The query string kept (tokens in error_logs).
// @mutate supabase/functions/csp-report/report.ts | return (parsed.origin + parsed.pathname).slice(0, 300); | return u.slice(0, 300);
// The source tag changed.
// @mutate supabase/functions/csp-report/report.ts | tags: { source: "csp", directive | tags: { source: "client-error", directive
