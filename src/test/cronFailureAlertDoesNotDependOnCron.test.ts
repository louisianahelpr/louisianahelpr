/*
 * CLASS GUARD: the report of a cron outage must not be delivered by a cron.
 *
 * MEASURED, 2026-09-22. pg_cron refused to START 457 scheduled runs between
 * 06:00 and 15:00 UTC ("job startup timeout" — the job did not run late, it
 * did not run). Throughput fell from ~78 runs/hour to 8. Every daily job in
 * that window never ran, and nothing retries a missed run.
 *
 * Nobody was told for nine hours, for two reasons:
 *
 *  1. `sweep_dead_crons` grades a job 'erroring' only after "its last 3 runs
 *     all failed" — three hours for an hourly job, three DAYS for a daily one.
 *     It first flagged at 14:53, as the incident was ending.
 *
 *  2. `cron-dead` rows are written at severity 'error'.
 *     `notify_slack_on_error_log()` pages only for `severity = 'fatal'` or four
 *     allow-listed sources; everything else is, in its own words, "counted in
 *     send_ops_daily_digest()". And send_ops_daily_digest IS a cron —
 *     `ops-daily-digest` — which failed in this very incident with the same
 *     `job startup timeout`.
 *
 * The channel that would have reported the outage was taken out by the outage.
 * That is the "signal structurally incapable of going red" shape this project
 * keeps rediscovering, so it gets a test rather than a comment.
 *
 * WHAT THIS PINS: any sweep whose job is detecting that CRON ITSELF is broken
 * must write 'fatal', because 'fatal' is the documented path that reaches
 * `notify_slack_on_error_log()` directly. A cron-health sweep writing 'error'
 * is routing its own outage report through the thing that is out.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations");

const bodies = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS, f), "utf8") }));

/** The executable body of a `$fn$ ... $fn$` function, comments stripped. */
const fnBody = (sql: string, name: string): string | null => {
  const i = sql.indexOf(`FUNCTION public.${name}(`);
  if (i === -1) return null;
  // Any dollar-quote tag ($fn$, $function$, $$, ...). Matching only `$fn$`
  // made this guard read the PREVIOUS definition whenever a newer migration
  // used another tag — 20260923050055 ($function$) was invisible to it and a
  // revert of its fix stayed green (2026-09-23).
  const m = sql.slice(i).match(/AS (\$[A-Za-z_]*\$)([\s\S]*?)\1;/);
  if (!m) return null;
  return m[2].replace(/--.*$/gm, "");
};

const latestBody = (name: string): string | null => {
  // Last definition wins on replay — that is the one prod runs.
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = fnBody(bodies[i].sql, name);
    if (b) return b;
  }
  return null;
};

describe("a cron outage is not reported through a cron", () => {
  it("found the migrations (cannot pass vacuously)", () => {
    expect(bodies.length).toBeGreaterThan(100);
  });

  it("reads the NEWEST definition, whatever its dollar-quote tag", () => {
    const defs = bodies.filter((b) => b.sql.includes("FUNCTION public.sweep_cron_startup_failures("));
    const newest = defs[defs.length - 1];
    expect(fnBody(newest.sql, "sweep_cron_startup_failures"), `could not parse ${newest.file}`).toBeTruthy();
  });

  it("the startup-timeout sweep exists and writes FATAL, not error", () => {
    const body = latestBody("sweep_cron_startup_failures");
    expect(body, "sweep_cron_startup_failures must be defined").toBeTruthy();
    expect(
      body!,
      "It must INSERT at severity 'fatal'. 'error' is routed to " +
        "send_ops_daily_digest(), which is the `ops-daily-digest` CRON — the " +
        "exact thing that dies in a cron outage.",
    ).toMatch(/INSERT INTO public\.error_logs[\s\S]{0,200}?'fatal'/);
  });

  it("it keys on pg_cron's own startup-timeout message, not a run count", () => {
    const body = latestBody("sweep_cron_startup_failures")!;
    // The whole point is detecting after ONE bad run. A "last N runs" rule is
    // what made sweep_dead_crons nine hours late.
    expect(body).toContain("startup timeout");
    expect(body).toContain("cron.job_run_details");
  });

  it("it counts a failed run of ANY kind, not only startup timeouts (Q33)", () => {
    const body = latestBody("sweep_cron_startup_failures")!;
    // 2026-09-22 19:00Z: 18 crons failed with "connection failed" and nothing
    // paged, because the WHERE matched only '%startup timeout%'. The count must
    // key on the run's status, and the startup-timeout text may only be used
    // to describe the page, never to decide whether to send it.
    const where = /FROM cron\.job_run_details[\s\S]*?WHERE([\s\S]*?);/.exec(body)?.[1] ?? "";
    expect(where, "could not find the counting query's WHERE clause").not.toBe("");
    expect(where).toMatch(/d\.status\s*=\s*'failed'/);
    expect(where, "the WHERE must not filter to startup timeouts only").not.toMatch(/startup timeout/);
  });

  it("it does not spam: a floor to ignore background noise, and a dedupe", () => {
    const body = latestBody("sweep_cron_startup_failures")!;
    // 0-15 stray timeouts/day were normal in the week before the incident, and
    // 457 failures must not become 457 pages.
    expect(body, "must have a floor below which it stays quiet").toMatch(/v_floor/);
    expect(body, "must dedupe on its own window").toContain("cron-startup-timeout");
    expect(body).toMatch(/already_reported_at|v_last/);
  });

  it("it is detection only — it must not try to run anyone's job", () => {
    const body = latestBody("sweep_cron_startup_failures")!;
    for (const f of ["cron.schedule", "UPDATE ", "DELETE "]) {
      expect(body, `the sweep must not contain "${f}" — it reports, it does not act`).not.toContain(f);
    }
  });
});

// Proof this is able to fail — 'error' is exactly the routing that left the
// 2026-09-22 outage unreported for nine hours.
// @mutate supabase/migrations/20260923050055_cron_fleet_failures_any_kind.sql |    AND d.status = 'failed'; |    AND d.status = 'never';
