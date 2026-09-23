// @mutate scripts/lib/analyticsFreshness.mjs |     return real >= 1 ? "broken" : "quiet"; |     return "quiet";
// @mutate scripts/lib/analyticsFreshness.mjs |   if (hasGround && real >= min && events < real * ratio) return "degraded"; |
// @mutate scripts/lib/analyticsFreshness.mjs |   first_job_completed: "first-time variant of job_completed", |
// @mutate src/lib/jobCompletedEvent.ts |   track(AhaEvent.JobCompleted, { job_id: jobId, source }); |
// @mutate src/lib/analytics.ts |   JobCompleted: "job_completed", |   JobCompleted: "job_completed", NeverSent: "never_sent",
// @mutate src/pages/activity/activityActions/useOfferHandlers.ts |         if (!hiredErr && (count ?? 0) <= 1) track(AhaEvent.FirstHelperHired, { job_id: selectedJob.id }); |
// @mutate scripts/lib/analyticsFreshness.mjs |   nps_submitted: "survey plumbing", |
// @mutate scripts/check-analytics-freshness.mjs |     process.exit(1); |     process.exit(0);
// @mutate .github/workflows/quota-monitor.yml |         run: node scripts/check-analytics-freshness.mjs |         run: echo skipped
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { AhaEvent } from "@/lib/analytics";
import { blankComments } from "./helpers/blankNonCode";
import {
  KEY_EVENTS, MISSING_MILESTONES, NOT_MONITORED, classify, evaluateFreshness, freshnessSql,
} from "../../scripts/lib/analyticsFreshness.mjs";

/**
 * Q72: analytics that silently stop. The monitored list is DERIVED from the
 * app: every event name any non-test `track(` call in src/ emits must be a KEY
 * event or in NOT_MONITORED with a reason, and every name in those lists must
 * still be emitted (two-way). MISSING_MILESTONES (owner-named milestones with
 * no event today) must stay un-emitted, so the day one gains a call site this
 * fails until it is monitored. Then the quiet-vs-broken maths, and the CLI
 * against a stub Management API.
 */

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "__tests__" || name === "integrations") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const AHA = AhaEvent as Record<string, string>;

/** event name -> call sites, from every `track(` in non-test source (comments blanked). */
function emittedEvents(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const add = (ev: string, where: string) => found.set(ev, [...(found.get(ev) ?? []), where]);
  for (const file of walk(SRC)) {
    const code = blankComments(readFileSync(file, "utf8"));
    const rel = relative(ROOT, file);
    // `void track(` / `track(` but not `ch.track(` (Realtime presence).
    for (const m of code.matchAll(/(?<![.\w])track\(\s*(?:AhaEvent\.(\w+)|"([a-z0-9_]+)"|'([a-z0-9_]+)')/g)) {
      const name = m[1] ? AHA[m[1]] : m[2] ?? m[3];
      expect(name, `${rel}: track(AhaEvent.${m[1]}) names no AhaEvent member`).toBeTruthy();
      add(name, rel);
    }
  }
  return found;
}

describe("the monitored event list is derived from the track( call sites", () => {
  const emitted = emittedEvents();
  const key = KEY_EVENTS.map((k) => k.event);

  it("found the app's events (cannot pass vacuously)", () => {
    expect(emitted.size).toBeGreaterThan(20);
    expect(key.length).toBeGreaterThan(5);
  });

  it("every emitted event is monitored or listed with a reason", () => {
    const unaccounted = [...emitted.keys()].filter((e) => !key.includes(e) && !(e in NOT_MONITORED)).sort();
    expect(unaccounted, `emitted but neither KEY_EVENTS nor NOT_MONITORED (scripts/lib/analyticsFreshness.mjs): ${unaccounted.join(", ")}`).toEqual([]);
  });

  it("every listed event is still emitted (no stale entries)", () => {
    const stale = [...key, ...Object.keys(NOT_MONITORED)].filter((e) => !emitted.has(e)).sort();
    expect(stale, `listed but no track( call emits it: ${stale.join(", ")}`).toEqual([]);
    expect(key.filter((e) => e in NOT_MONITORED)).toEqual([]);
    for (const [e, why] of Object.entries(NOT_MONITORED)) expect(why.length, e).toBeGreaterThan(10);
  });

  it("the missing milestones are really missing (move them to KEY_EVENTS the day they are emitted)", () => {
    const nowEmitted = Object.keys(MISSING_MILESTONES).filter((e) => emitted.has(e));
    expect(nowEmitted, `now emitted — monitor it: ${nowEmitted.join(", ")}`).toEqual([]);
  });

  it("every declared AhaEvent is emitted somewhere (no dead funnel steps, Q222)", () => {
    const dead = Object.entries(AHA).filter(([, v]) => !emitted.has(v)).map(([k, v]) => `AhaEvent.${k} (${v})`).sort();
    expect(dead, `declared in src/lib/analytics.ts but no track( call emits it — emit it or delete it: ${dead.join(", ")}`).toEqual([]);
    expect(Object.keys(AHA).length).toBeGreaterThan(20);
  });

  it("covers every milestone the owner named: signup, posted, applied, hired, paid, completed, reviewed, message sent", () => {
    const labels = KEY_EVENTS.map((k) => k.label).join(" | ");
    for (const m of ["signup", "posted", "applied", "hired", "paid", "completed", "reviewed", "message sent"]) expect(labels, m).toContain(m);
    expect(key).toContain("job_completed");
  });
});

describe("quiet vs broken", () => {
  const row = (events: number | null, real: number | null) => ({ event: "x", events, real_actions: real });
  it("classifies", () => {
    expect(classify(row(3, 0), true)).toBe("ok");
    expect(classify(row(3, 5), true)).toBe("ok");
    expect(classify(row(0, 0), true)).toBe("quiet");
    expect(classify(row(0, 1), true)).toBe("broken");
    expect(classify(row(0, 40), true)).toBe("broken");
    expect(classify(row(4, 10), true)).toBe("degraded");
    expect(classify(row(5, 10), true)).toBe("ok");
    expect(classify(row(1, 9), true)).toBe("ok"); // under DEGRADED_MIN real actions: too few to call a ratio
    expect(classify(row(0, null), false)).toBe("unverified");
    expect(classify(row(2, null), false)).toBe("ok");
  });
  it("a missing or nonsense read is unreadable, never quiet", () => {
    expect(classify(undefined, true)).toBe("unreadable");
    expect(classify(row(null, 0), true)).toBe("unreadable");
    expect(classify(row(0, null), true)).toBe("unreadable");
    expect(classify(row(-1, 0), true)).toBe("unreadable");
    const res = evaluateFreshness([]);
    expect(res.unreadable.length).toBe(KEY_EVENTS.length);
  });
  it("the SQL asks for every key event and fills every window", () => {
    const sql = freshnessSql();
    for (const k of KEY_EVENTS) expect(sql).toContain(`'${k.event}' AS event`);
    expect(sql).not.toContain("$SINCE");
    expect(sql.match(/UNION ALL/g)?.length).toBe(KEY_EVENTS.length - 1);
  });
});

// ── the CLI against a stub Management API ───────────────────────────────────
let server: Server;
let base = "";
let reply: { code: number; body: unknown } = { code: 200, body: [] };
beforeAll(async () => {
  server = createServer((_req, res) => {
    res.statusCode = reply.code;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function runCli(code: number, body: unknown): Promise<{ code: number; out: string }> {
  reply = { code, body };
  const env = {
    PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/tmp",
    SUPABASE_ACCESS_TOKEN: "stub", SUPABASE_PROJECT_REF: "stub", LH_SUPABASE_API_BASE: base,
  };
  return new Promise((done) => {
    execFile(process.execPath, ["scripts/check-analytics-freshness.mjs", "--no-ledger"], { cwd: ROOT, env, timeout: 60_000 }, (err, stdout, stderr) => {
      done({ code: err ? Number((err as NodeJS.ErrnoException).code ?? 1) : 0, out: `${stdout}\n${stderr}` });
    });
  });
}

const rowsWith = (over: Record<string, { events: number; real: number | null }>) =>
  KEY_EVENTS.map((k) => ({
    event: k.event, window_days: k.windowDays, events: over[k.event]?.events ?? 0, test_events: 0, last_event_at: null,
    real_actions: k.ground ? over[k.event]?.real ?? 0 : null, test_actions: k.ground ? 0 : null,
  }));

describe("check-analytics-freshness.mjs (stub API)", () => {
  it("pre-launch quiet week -> green, reported QUIET, nothing alerted", async () => {
    const { code, out } = await runCli(200, rowsWith({}));
    expect(code, out).toBe(0);
    expect(out).toMatch(/\*\*QUIET\*\*/);
    expect(out).not.toMatch(/::warning title=Analytics/);
  }, 90_000);
  it("real signups but zero signup events -> BROKEN alert", async () => {
    const { code, out } = await runCli(200, rowsWith({ signup_completed: { events: 0, real: 3 }, job_posted: { events: 2, real: 2 } }));
    expect(code, out).toBe(0);
    expect(out).toMatch(/::warning title=Analytics broken::Analytics: signup_completed stopped recording/);
  }, 90_000);
  it("a failed read -> red", async () => {
    const { code, out } = await runCli(500, { message: "stub failure" });
    expect(code).toBe(1);
    expect(out).toMatch(/could not read analytics_events: Management API SQL 500/);
  }, 90_000);
  it("an empty read -> red, not quiet", async () => {
    const { code, out } = await runCli(200, []);
    expect(code).toBe(1);
    expect(out).toMatch(/expected \d+ rows, got 0 — refusing to report clean/);
  }, 90_000);
});

describe("quota-monitor.yml runs the analytics check", () => {
  it("daily, with the Management API secrets", () => {
    const wf = readFileSync(join(ROOT, ".github/workflows/quota-monitor.yml"), "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    expect(wf).toMatch(/-\s*cron:\s*"\d+ \d+ \* \* \*"/);
    expect(wf).toMatch(/run: node scripts\/check-analytics-freshness\.mjs\s*$/m);
    expect(wf).toMatch(/needs\.analytics\.result == 'success'/);
  });
});
