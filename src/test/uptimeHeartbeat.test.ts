// @mutate vercel.json | "schedule": "*/10 * * * *" | "schedule": "0 9 * * *"
// @mutate vercel.json | "maxDuration": 90 | "maxDuration": 15
// @mutate api/uptime-heartbeat.ts |     const alerted = verdict.status === "down" && fromCron ? await alertDown(verdict.summary) : "no"; |     const alerted = "no";
// @mutate api/uptime-heartbeat.ts |       if (res.status !== 401) break; |       break;
// @mutate api/uptime-heartbeat.ts |     if (secret && auth !== `Bearer ${secret}`) { |     if (false) {
// @mutate api/uptime-heartbeat.ts |       emptyIsWarning: EMPTY_IS_WARNING_BEFORE_LAUNCH, |       emptyIsWarning: false,
import { describe, expect, it, beforeAll, afterAll, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Q936 (owner, 2026-10-07): uptime.yml's every-10-minute cron is throttled by
 * GitHub to runs 164-558 minutes apart (its last 40 scheduled runs, 2026-09-28
 * .. 2026-10-06), so an outage could go unseen for hours. The fix is a watcher
 * OFF GitHub: a Vercel Cron calls api/uptime-heartbeat.ts every 10 minutes,
 * which runs the same check (scripts/lib/uptimeProbe.mjs) and posts a critical
 * #ops-alerts alert through slack-ops-alert when prod is down.
 *
 * Pinned here: the cron is declared at 10 minutes and points at a function
 * that exists; every verdict is driven through the real handler with fetch
 * stubbed (no network): up and empty never alert, down alerts exactly when
 * Vercel Cron called, a refused key is retried with the other key, and a
 * CRON_SECRET, when set, is required.
 */

const ROOT = join(__dirname, "..", "..");
type Handler = { fetch: (req: Request) => Promise<Response> };
let handler: Handler;

type Reply = { status: number; body: string };
let site: Reply;
let db: Reply;
let alertReplies: number[];
let alerts: { auth: string; body: Record<string, unknown> }[];

const ENV = {
  SUPABASE_URL: "https://stub.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "pub",
  SUPABASE_SECRET_KEY: "secret-a",
  SUPABASE_SERVICE_ROLE_KEY: "secret-b",
  UPTIME_ROUND_GAP_MS: "0",
};
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/functions/v1/slack-ops-alert")) {
      const status = alertReplies.shift() ?? 200;
      alerts.push({ auth: String((init?.headers as Record<string, string>)?.Authorization ?? ""), body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status });
    }
    const r = url.includes("/rest/v1/") ? db : site;
    return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
  });
  // Runtime-built path: tsc (tsconfig.app.json covers src/) never pulls api/ in.
  const p = ["..", "..", "api", "uptime-heartbeat"].join("/");
  handler = (await import(/* @vite-ignore */ p)).default;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

afterAll(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function call(headers: Record<string, string> = { "user-agent": "vercel-cron/1.0" }) {
  alerts = [];
  alertReplies = [];
  const res = await handler.fetch(new Request("https://www.louisianahelpr.com/api/uptime-heartbeat", { headers }));
  return { http: res.status, json: (await res.json()) as { status: string; summary: string; alerted: string } };
}

describe("Q936: the off-GitHub uptime heartbeat", () => {
  it("vercel.json schedules it every 10 minutes, and the function exists", () => {
    const cfg = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    expect(cfg.crons).toEqual([{ path: "/api/uptime-heartbeat", schedule: "*/10 * * * *" }]);
    // Two failed rounds 20 s apart with 10 s probe timeouts take ~40 s; the
    // default function limit would kill a DOWN run before it alerts.
    expect(cfg.functions?.["api/uptime-heartbeat.ts"]?.maxDuration).toBeGreaterThanOrEqual(60);
    expect(readFileSync(join(ROOT, "api", "uptime-heartbeat.ts"), "utf8")).toMatch(/export default \{\n\s+async fetch\(/);
  });

  it("up: 200 and no alert", async () => {
    site = { status: 200, body: "<html></html>" };
    db = { status: 200, body: '[{"id":"x"}]' };
    const r = await call();
    expect(r.http).toBe(200);
    expect(r.json.status).toBe("up");
    expect(alerts).toEqual([]);
  });

  it("empty before launch: a warning uptime.yml already files, never a page from here", async () => {
    site = { status: 200, body: "<html></html>" };
    db = { status: 200, body: "[]" };
    const r = await call();
    expect(r.json.status).toBe("empty");
    expect(alerts).toEqual([]);
  });

  it("down, called by Vercel Cron: 503 and ONE critical alert to slack-ops-alert", async () => {
    site = { status: 200, body: "<html></html>" };
    db = { status: 503, body: '{"message":"database unavailable"}' };
    const r = await call();
    expect(r.http).toBe(503);
    expect(r.json.status).toBe("down");
    expect(r.json.summary).toMatch(/database: HTTP 503: .*database unavailable/);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].auth).toBe("Bearer secret-a");
    expect(alerts[0].body).toMatchObject({ severity: "critical", title: expect.stringMatching(/DOWN/) });
    expect(r.json.alerted).toMatch(/^sent/);
  });

  it("a refused key is retried once with the other key", async () => {
    site = { status: 500, body: "boom" };
    db = { status: 200, body: '[{"id":"x"}]' };
    alerts = [];
    const res = await (async () => {
      alertReplies = [401, 200];
      const out = await handler.fetch(new Request("https://www.louisianahelpr.com/api/uptime-heartbeat", { headers: { "user-agent": "vercel-cron/1.0" } }));
      return out.json() as Promise<{ alerted: string }>;
    })();
    expect(alerts.map((a) => a.auth)).toEqual(["Bearer secret-a", "Bearer secret-b"]);
    expect(res.alerted).toMatch(/^sent/);
  });

  it("down, called by anyone else: the verdict, but no alert (the URL cannot spam the channel)", async () => {
    site = { status: 500, body: "boom" };
    db = { status: 200, body: '[{"id":"x"}]' };
    const r = await call({ "user-agent": "curl/8" });
    expect(r.json.status).toBe("down");
    expect(alerts).toEqual([]);
  });

  it("with CRON_SECRET set, a call without it is refused", async () => {
    process.env.CRON_SECRET = "cs";
    site = { status: 200, body: "<html></html>" };
    db = { status: 200, body: '[{"id":"x"}]' };
    expect((await call({ "user-agent": "vercel-cron/1.0" })).http).toBe(401);
    expect((await call({ authorization: "Bearer cs" })).http).toBe(200);
  });
});
