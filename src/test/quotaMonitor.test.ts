// @mutate scripts/lib/quotaMonitor.mjs | if (ratio >= warnAt) return { status: "warn", pct }; | if (ratio > warnAt + 0.1) return { status: "warn", pct };
// @mutate scripts/lib/quotaMonitor.mjs | if (!r \|\| r.error \|\| typeof r.value !== "number") { | if (false) {
// @mutate scripts/lib/quotaMonitor.mjs |       rows.push({ q, limit, used: null, status: "not-monitored", pct: null, note: q.why }); |       rows.push({ q, limit, used: 0, status: "ok", pct: 0, note: q.why });
// @mutate scripts/check-quota-usage.mjs |     process.exit(1); |     process.exit(0);
// @mutate scripts/check-quota-usage.mjs |   if (!(db > 0)) fail( |   if (false) fail(
// @mutate .github/workflows/quota-monitor.yml |         run: node scripts/check-quota-usage.mjs |         run: echo skipped
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QUOTAS, WARN_AT, effectiveLimit, evaluateQuotas, grade } from "../../scripts/lib/quotaMonitor.mjs";

/**
 * Q63: a quota/limit monitor that alerts at 80% and is never silently green.
 * Pins (1) the threshold maths, (2) that a failed or missing read is
 * UNREADABLE (a red run), never "ok", (3) that a quota with no API is listed
 * as NOT MONITORED, never dropped and never graded ok, and (4) the CLI end to
 * end against a stub Management / GitHub / Sentry API.
 */

const ROOT = join(__dirname, "..", "..");
const GB = 1024 ** 3;

describe("quota threshold maths", () => {
  it("alerts at 80%, over at 100%", () => {
    expect(WARN_AT).toBe(0.8);
    expect(grade(79, 100).status).toBe("ok");
    expect(grade(79.99, 100).status).toBe("ok");
    expect(grade(80, 100)).toEqual({ status: "warn", pct: 80 });
    expect(grade(99, 100).status).toBe("warn");
    expect(grade(100, 100)).toEqual({ status: "over", pct: 100 });
    expect(grade(250, 100).status).toBe("over");
    expect(grade(0, 100)).toEqual({ status: "ok", pct: 0 });
    expect(grade(6.5 * GB, 8 * GB).status).toBe("warn");
  });

  it("a nonsense reading is unreadable, never 0%", () => {
    for (const [used, limit] of [[NaN, 100], [-1, 100], [5, 0], [5, null], [undefined, 100], [5, Infinity]] as const) {
      expect(grade(used as number, limit as number).status, `${used}/${limit}`).toBe("unreadable");
    }
  });

  it("limit precedence: env override, then the live limit, then the table", () => {
    const q = QUOTAS.find((x) => x.id === "supabase.connections")!;
    expect(effectiveLimit(q, {}, {})).toBeNull();
    expect(effectiveLimit(q, {}, { "supabase.connections": 60 })).toBe(60);
    expect(effectiveLimit(q, { [q.env]: "200" }, { "supabase.connections": 60 })).toBe(200);
    expect(effectiveLimit(q, { [q.env]: "garbage" }, { "supabase.connections": 60 })).toBe(60);
    const db = QUOTAS.find((x) => x.id === "supabase.db_size")!;
    expect(effectiveLimit(db)).toBe(8 * GB);
  });
});

describe("quota inventory", () => {
  it("covers every quota the owner named (floor + ids)", () => {
    expect(QUOTAS.length).toBeGreaterThan(8);
    const ids = QUOTAS.map((q) => q.id);
    for (const id of [
      "supabase.db_size", "supabase.egress", "supabase.connections", "supabase.edge_invocations",
      "supabase.realtime_messages", "supabase.storage", "vercel.deploys_per_day", "resend.sends_month", "sentry.errors_30d", "sentry.replays_30d",
    ]) expect(ids, id).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every quota states its limit source and override; every unreadable-by-design one says why", () => {
    for (const q of QUOTAS) {
      expect(q.limitSource.length, q.id).toBeGreaterThan(40);
      expect(q.env, q.id).toMatch(/^LH_QUOTA_[A-Z_]+$/);
      if (q.read === null) expect(q.why?.length ?? 0, `${q.id} has no API and must say why`).toBeGreaterThan(40);
      if (q.id !== "supabase.connections") expect(q.limit, q.id).toBeGreaterThan(0);
    }
    // The Vercel cap is the FREE plan's (the owner, 2026-09-23), not Pro's.
    expect(QUOTAS.find((q) => q.id === "vercel.deploys_per_day")!.limit).toBe(100);
  });
});

describe("evaluateQuotas", () => {
  const allOk = () => {
    const r: Record<string, { value: number }> = {};
    for (const q of QUOTAS) if (q.read) r[q.id] = { value: 1 };
    return r;
  };
  const live = { "supabase.connections": 60 };

  it("all readable and low -> no alerts, no unreadable, but NOT MONITORED rows are listed", () => {
    const res = evaluateQuotas(allOk(), { live });
    expect(res.alerts).toEqual([]);
    expect(res.unreadable).toEqual([]);
    const nm = res.notMonitored.map((r) => r.q.id).sort();
    expect(nm).toEqual(QUOTAS.filter((q) => q.read === null).map((q) => q.id).sort());
    expect(nm.length).toBeGreaterThan(0);
    expect(res.summary).toMatch(/NOT MONITORED/);
    expect(res.report).toMatch(/NOT-MONITORED/);
    for (const r of res.notMonitored) expect(r.status).not.toBe("ok");
  });

  it("a missing reading or an error is UNREADABLE, never ok", () => {
    const readings: Record<string, { value?: number; error?: string }> = allOk();
    delete readings["supabase.db_size"];
    readings["sentry.errors_30d"] = { error: "Sentry 403" };
    const res = evaluateQuotas(readings, { live });
    expect(res.unreadable.map((r) => r.q.id).sort()).toEqual(["sentry.errors_30d", "supabase.db_size"]);
    expect(res.summary).toMatch(/^UNREADABLE 2/);
  });

  it("connections with no live limit and no override are unreadable (nothing to be 80% of)", () => {
    const res = evaluateQuotas(allOk(), { live: {} });
    expect(res.unreadable.map((r) => r.q.id)).toEqual(["supabase.connections"]);
  });

  it("80% alerts as warn, 100% as over", () => {
    const readings = allOk();
    readings["vercel.deploys_per_day"] = { value: 85 };
    readings["resend.sends_day"] = { value: 100 };
    const res = evaluateQuotas(readings, { live });
    expect(res.alerts.map((r) => [r.q.id, r.status])).toEqual([["vercel.deploys_per_day", "warn"], ["resend.sends_day", "over"]]);
  });
});

// ── the CLI, end to end, against a stub API ─────────────────────────────────
type Mode = {
  sql: "ok" | "empty" | "fail" | "full" | "zero"; logs: "ok" | "fail"; gh: "ok" | "empty"; sentry: "ok" | "forbidden";
  replays?: "low" | "dropping";
  errors?: "low" | "dropping";
};
let server: Server;
let base = "";
let mode: Mode = { sql: "ok", logs: "ok", gh: "ok", sentry: "ok" };

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    res.setHeader("Content-Type", "application/json");
    const send = (code: number, body: unknown) => { res.statusCode = code; res.end(JSON.stringify(body)); };
    if (url.includes("/database/query")) {
      if (mode.sql === "fail") return send(500, { message: "stub failure" });
      if (mode.sql === "empty") return send(200, []);
      const db = mode.sql === "full" ? String(7 * GB) : mode.sql === "zero" ? "0" : String(200 * 1024 * 1024);
      return send(200, [{ db_bytes: db, max_conns: 60, client_conns: 9, storage_bytes: "21000000", storage_objects: 95, emails_month: 12, emails_day: 1 }]);
    }
    if (url.includes("/analytics/endpoints/logs?")) return mode.logs === "fail" ? send(500, { message: "x" }) : send(200, { result: [{ n: 1200 }] });
    if (url.includes("/deployments")) {
      if (mode.gh === "empty") return send(200, []);
      const now = Date.now();
      return send(200, [{ created_at: new Date(now - 3600_000).toISOString() }, { created_at: new Date(now - 3 * 86400_000).toISOString() }]);
    }
    if (url.includes("/stats_v2/")) {
      if (mode.sentry === "forbidden") return send(403, { detail: "forbidden" });
      if (url.includes("category=replay")) {
        // Q275: the replay quota. "dropping" = the state of 2026-09-23: the
        // cap reached and Sentry refusing the rest (outcome rate_limited).
        const dropped = mode.replays === "dropping";
        return send(200, {
          intervals: ["2026-09-22T00:00:00Z"],
          groups: [
            { by: { outcome: "accepted" }, totals: { "sum(quantity)": dropped ? 50 : 3 } },
            { by: { outcome: "rate_limited" }, totals: { "sum(quantity)": dropped ? 37 : 0 } },
          ],
        });
      }
      if (url.includes("category=error")) {
        // Q311: Sentry recorded zero errors for ~17h; "dropping" reproduces a
        // quota/rate-limit drop so the accepted-only read stays blind while
        // this outcome-split read catches it.
        const dropped = mode.errors === "dropping";
        return send(200, {
          intervals: ["2026-09-22T00:00:00Z"],
          groups: [
            { by: { outcome: "accepted" }, totals: { "sum(quantity)": dropped ? 0 : 42 } },
            { by: { outcome: "rate_limited" }, totals: { "sum(quantity)": dropped ? 4500 : 0 } },
            { by: { outcome: "filtered" }, totals: { "sum(quantity)": dropped ? 8 : 2 } },
            { by: { outcome: "invalid" }, totals: { "sum(quantity)": dropped ? 1 : 0 } },
          ],
        });
      }
      return send(200, { intervals: ["2026-09-22T00:00:00Z"], groups: [{ by: {}, totals: { "sum(quantity)": 42 } }] });
    }
    if (url.includes("/stats/")) return send(403, { detail: "forbidden" });
    return send(404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function runCli(m: Mode): Promise<{ code: number; out: string }> {
  mode = m;
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/tmp",
    SUPABASE_ACCESS_TOKEN: "stub", SUPABASE_PROJECT_REF: "stub", GITHUB_TOKEN: "stub",
    SENTRY_AUTH_TOKEN: "stub", SENTRY_ORG: "stub", SENTRY_PROJECT: "stub",
    LH_SUPABASE_API_BASE: base, LH_GITHUB_API_BASE: base, LH_SENTRY_API_BASE: base,
  };
  return new Promise((done) => {
    execFile(process.execPath, ["scripts/check-quota-usage.mjs", "--no-ledger"], { cwd: ROOT, env, timeout: 60_000 }, (err, stdout, stderr) => {
      done({ code: err ? Number((err as NodeJS.ErrnoException).code ?? 1) : 0, out: `${stdout}\n${stderr}` });
    });
  });
}

describe("check-quota-usage.mjs (stub APIs)", () => {
  it("everything readable and low -> exit 0, every readable quota measured, no-API quotas warned", async () => {
    const { code, out } = await runCli({ sql: "ok", logs: "ok", gh: "ok", sentry: "ok" });
    expect(code, out).toBe(0);
    expect(out).not.toMatch(/\*\*UNREADABLE\*\*/);
    expect(out).toMatch(/Deployments created \(last 24h\) \| 1 \| 100/);
    expect(out).toMatch(/Database connections \| 9 \| 60/);
    expect(out).toMatch(/::warning title=Quota NOT monitored::Supabase Egress/);
    expect(out).toMatch(/::warning title=Quota NOT monitored::Supabase Realtime messages/);
  }, 90_000);

  it("database at 7 of 8 GB -> warns at 87.5%, run stays green", async () => {
    const { code, out } = await runCli({ sql: "full", logs: "ok", gh: "ok", sentry: "ok" });
    expect(code, out).toBe(0);
    expect(out).toMatch(/::warning title=Quota at 87.5%::Supabase Database size/);
  }, 90_000);

  it("a failed read -> red, named, never green", async () => {
    const { code, out } = await runCli({ sql: "ok", logs: "fail", gh: "ok", sentry: "ok" });
    expect(code).toBe(1);
    expect(out).toMatch(/Quota unreadable::Supabase Edge function invocations.*could not read edge invocations: Management API logs 500/);
  }, 90_000);

  it("an EMPTY read -> red ('refusing to report clean'), not 0%", async () => {
    const { code, out } = await runCli({ sql: "empty", logs: "ok", gh: "empty", sentry: "ok" });
    expect(code).toBe(1);
    expect(out).toMatch(/the usage SQL returned no row — refusing to report clean/);
    expect(out).toMatch(/GitHub returned no deployments at all — refusing to report clean/);
  }, 90_000);

  it("a database that reads as 0 bytes -> red, not 0%", async () => {
    const { code, out } = await runCli({ sql: "zero", logs: "ok", gh: "ok", sentry: "ok" });
    expect(code).toBe(1);
    expect(out).toMatch(/database size read as 0 — refusing to report clean/);
  }, 90_000);

  // Q275: Sentry showed "Replay Quota Exceeded" (2026-09-23) and no monitor saw it.
  // @mutate scripts/check-quota-usage.mjs |   await Promise.all([readSql(), readEdgeInvocations(), readDeploys(), readSentry(), readSentryReplays()]); |   await Promise.all([readSql(), readEdgeInvocations(), readDeploys(), readSentry()]);
  // @mutate scripts/check-quota-usage.mjs |       value: by.accepted + by.rate_limited,\n      note: `org stats_v2 category=replay: |       value: by.accepted,\n      note: `org stats_v2 category=replay:
  it("replays dropped by the Sentry quota -> the replay row reads OVER and alerts", async () => {
    const low = await runCli({ sql: "ok", logs: "ok", gh: "ok", sentry: "ok", replays: "low" });
    expect(low.code, low.out).toBe(0);
    expect(low.out).toMatch(/Session replays sent: accepted \+ dropped by quota \(last 30 days\) \| 3 \| 50/);
    const full = await runCli({ sql: "ok", logs: "ok", gh: "ok", sentry: "ok", replays: "dropping" });
    expect(full.code, full.out).toBe(0);
    expect(full.out).toMatch(/::warning title=Quota at 174%::Sentry Session replays sent/);
    expect(full.out).toMatch(/50 accepted, 37 dropped by quota/);
  }, 90_000);

  // Q311: Sentry recorded 0 errors for ~17h on 2026-09-23; an accepted-only read cannot tell
  // a genuinely quiet window from one where events are being dropped (quota /
  // rate limit). Ask for every outcome and count accepted + rate_limited
  // against the quota, the way the replay reader already does.
  // @mutate scripts/check-quota-usage.mjs |       value: by.accepted + by.rate_limited,\n      note: `org stats_v2 category=error: |       value: by.accepted,\n      note: `org stats_v2 category=error:
  it("errors dropped by the Sentry quota -> the errors row includes them and warns", async () => {
    const low = await runCli({ sql: "ok", logs: "ok", gh: "ok", sentry: "ok", errors: "low" });
    expect(low.code, low.out).toBe(0);
    expect(low.out).toMatch(/42 accepted, 0 dropped by quota \(rate_limited\), 2 filtered, 0 invalid/);
    const dropping = await runCli({ sql: "ok", logs: "ok", gh: "ok", sentry: "ok", errors: "dropping" });
    expect(dropping.code, dropping.out).toBe(0);
    // accepted (0) alone would read as 0/5000 (0%) and never warn; accepted +
    // rate_limited (4500) crosses the 80% warn line at LH_QUOTA_SENTRY_ERRORS.
    expect(dropping.out).toMatch(/::warning title=Quota at 90%::Sentry Error events/);
    expect(dropping.out).toMatch(/0 accepted, 4500 dropped by quota \(rate_limited\), 8 filtered, 1 invalid/);
  }, 90_000);

  it("Sentry refusing both endpoints -> red with both statuses", async () => {
    const { code, out } = await runCli({ sql: "ok", logs: "ok", gh: "ok", sentry: "forbidden" });
    expect(code).toBe(1);
    expect(out).toMatch(/Sentry stats_v2 403, project stats 403/);
  }, 90_000);
});

describe("quota-monitor.yml wiring", () => {
  const wf = readFileSync(join(ROOT, ".github/workflows/quota-monitor.yml"), "utf8");
  const code = wf.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  it("runs the quota check daily with the secrets it reads", () => {
    expect(code).toMatch(/-\s*cron:\s*"\d+ \d+ \* \* \*"/);
    expect(code).toMatch(/run: node scripts\/check-quota-usage\.mjs\s*$/m);
    for (const s of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF", "GITHUB_TOKEN", "SENTRY_AUTH_TOKEN", "SENTRY_ORG"]) {
      expect(code, s).toContain(`secrets.${s}`);
    }
    expect(code).toMatch(/deployments:\s*read/);
  });
});
