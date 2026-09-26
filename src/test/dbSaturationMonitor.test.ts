// @mutate supabase/migrations/20260925155922_admin_queue_alerts_close_themselves.sql | ELSIF p_source = 'db-saturation' THEN | ELSIF p_source = 'db-saturation-x' THEN
// @mutate supabase/migrations/20260923090536_db_saturation_monitor.sql | PERFORM cron.schedule('db-saturation-check', '*/5 * * * *', | PERFORM cron.schedule('db-saturation-check', '0 3 * * *',
// @mutate supabase/migrations/20260923090536_db_saturation_monitor.sql | jsonb_build_object('source', 'db-statement-timeouts', 'area', 'database'), | jsonb_build_object('source', 'db-statement-timeout', 'area', 'database'),
// @mutate supabase/migrations/20260924132850_cron_log_keys_survive_pg_net_id_reuse.sql | JOIN firsts f ON f.jobname = m.jobname | CROSS JOIN LATERAL (SELECT COALESCE((SELECT min(m2.rn) FROM marked m2 WHERE m2.jobname = m.jobname AND NOT m2.suspicious), 2147483647) AS first_ok) f
// @mutate .github/workflows/prod-errors.yml | run: node scripts/db-saturation-check.mjs | run: echo skipped
// @mutate scripts/db-saturation-check.mjs | if (!Number.isFinite(n)) throw | if (false) throw
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { countFromLogsBody } from "../../scripts/db-saturation-check.mjs";

/**
 * Q53: the database starved on 2026-09-22 (19-42 statement timeouts an hour,
 * 08:00-15:00Z) and nothing watched the signals that would have shown it
 * coming. This pins the monitor's wiring against the NEWEST definition of
 * each object (any dollar-quote tag; comments stripped), so a later migration
 * that redefines ops_alert_condition or sweep_silent_cron_failures and drops
 * the branch / reintroduces the quadratic scan fails here. Behaviour is
 * proven in src/test/pglite/dbSaturation.pglite.mjs (thresholds, dedupe,
 * close rule, same streaks as the old sweep).
 */

const ROOT = join(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const stripSqlComments = (s: string) => s.replace(/--[^\n]*/g, "");

/** Body of the newest `CREATE [OR REPLACE] FUNCTION public.<name>(` across all migrations. */
function newestFunction(name: string): { file: string; body: string } | null {
  let found: { file: string; body: string } | null = null;
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
  for (const file of files) {
    const sql = readFileSync(join(MIG, file), "utf8");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index!);
      const tag = rest.match(/AS\s+(\$[A-Za-z_]*\$)/);
      if (!tag) continue;
      const open = rest.indexOf(tag[1], tag.index!) + tag[1].length;
      const close = rest.indexOf(tag[1], open);
      found = { file, body: stripSqlComments(rest.slice(open, close)) };
    }
  }
  return found;
}

describe("DB saturation monitor (Q53)", () => {
  it("reads a real migration history", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("check_db_saturation reads every signal and reports both sources", () => {
    const f = newestFunction("check_db_saturation");
    expect(f, "public.check_db_saturation is defined by a migration").not.toBeNull();
    const b = f!.body;
    for (const signal of ["pg_stat_activity", "max_connections", "idle in transaction", "pg_stat_statements", "query_start"]) {
      expect(b, `check_db_saturation must read ${signal}`).toContain(signal);
    }
    expect(b).toMatch(/'source',\s*'db-saturation'/);
    expect(b).toMatch(/'source',\s*'db-statement-timeouts'/);
    expect(b).toMatch(/date_trunc\('hour', now\(\)\)/);
  });

  it("the newest ops_alert_condition closes both sources only on a newer sample", () => {
    const f = newestFunction("ops_alert_condition");
    expect(f).not.toBeNull();
    for (const src of ["db-saturation", "db-statement-timeouts"]) {
      const at = f!.body.indexOf(`p_source = '${src}'`);
      expect(at, `ops_alert_condition (${f!.file}) has no '${src}' branch`).toBeGreaterThan(-1);
      const branch = f!.body.slice(at, f!.body.indexOf("ELSIF", at + 10));
      expect(branch).toMatch(/sampled_at > p_since/);
      expect(branch).toMatch(/IF NOT FOUND THEN RETURN NULL;/);
    }
  });

  it("is scheduled every 5 minutes, with a liveness expectation, in the newest schedule for it", () => {
    let schedule: string | null = null;
    let expectation = false;
    for (const file of files) {
      const sql = stripSqlComments(readFileSync(join(MIG, file), "utf8"));
      for (const m of sql.matchAll(/cron\.(schedule|unschedule)\s*\(\s*'db-saturation-check'(?:\s*,\s*'([^']+)')?/g)) {
        schedule = m[1] === "schedule" ? m[2] : null;
      }
      if (/cron_work_expectations[\s\S]*?'db-saturation-check'/.test(sql)) expectation = true;
    }
    expect(schedule).toBe("*/5 * * * *");
    expect(expectation).toBe(true);
  });

  it("sweep_silent_cron_failures has no correlated re-scan of `marked` (2.5 s on prod)", () => {
    const f = newestFunction("sweep_silent_cron_failures");
    expect(f).not.toBeNull();
    expect(f!.body).toMatch(/FROM\s+marked\s+m\b/);
    // A subquery over `marked` correlated to the outer row (…FROM marked x
    // WHERE x.jobname = m.jobname) re-scans the CTE once per row.
    expect(f!.body, `${f!.file}: a correlated subquery over marked is quadratic`).not.toMatch(
      /FROM\s+marked\s+(\w+)\s+WHERE\s+\1\.jobname\s*=\s*m\.jobname/i,
    );
  });

  it("the hourly workflow feeds postgres_logs timeouts in, before the ledger sync", () => {
    const wf = readFileSync(join(ROOT, ".github/workflows/prod-errors.yml"), "utf8");
    const feed = wf.indexOf("run: node scripts/db-saturation-check.mjs");
    const sync = wf.indexOf("node scripts/ops-alert-ledger.mjs sync");
    expect(feed).toBeGreaterThan(-1);
    expect(sync).toBeGreaterThan(feed);
    expect(wf).toMatch(/cron: "47 \* \* \* \*"/);
  });

  it("an unreadable logs response throws instead of counting as zero timeouts", () => {
    expect(countFromLogsBody({ result: [{ n: 7 }] })).toBe(7);
    expect(() => countFromLogsBody({ result: [] })).toThrow();
    expect(() => countFromLogsBody({ error: { message: "x" } })).toThrow();
    expect(() => countFromLogsBody(null)).toThrow();
  });
});
