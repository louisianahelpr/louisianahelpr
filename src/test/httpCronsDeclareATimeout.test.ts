/*
 * CLASS GUARD: an HTTP cron must say how long to wait for the answer.
 *
 * `net.http_post` is asynchronous. `timeout_milliseconds` is how long pg_net's
 * background worker waits FOR THE RESPONSE — it does not cancel the request
 * and cannot stop the edge function, which runs to completion either way.
 *
 * So a too-short timeout does not lose work. It loses the ANSWER, which is
 * worse than it sounds:
 *
 *   * a slow success and a slow 500 become indistinguishable, and slow
 *     failures are exactly the ones worth seeing;
 *   * `sweep_cron_http_failures` grades jobs on those rows, so its verdict
 *     rests on a measurement that cannot tell the two apart;
 *   * every one is a row in error_logs, and since 2026-09-22 every severity
 *     posts to Slack, so noise is no longer free.
 *
 * MEASURED on prod, 2026-09-22: 25 of 26 HTTP crons never passed the argument
 * at all, so they inherited pg_net's DEFAULT of 5000ms — less than a Deno cold
 * start, before the function body has run a line. 103 of 185 cron-http rows in
 * seven days were the caller giving up while DNS was fast. `process-email-queue`
 * logged 23 such "timeouts" while all four of its queues sat at depth 0,
 * which is what proved the work was happening all along.
 *
 * The 5000 was never a decision — it was a default nobody overrode. This test
 * exists so the next scheduled function does not inherit it silently.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = join(__dirname, "..", "..", "supabase", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

/**
 * The migration that rewrote the existing 25. Anything scheduled BEFORE it is
 * already handled by that rewrite; only migrations after it must declare their
 * own timeout, so this cannot fail on history it has already fixed.
 */
const CUTOFF = "20260922222716_http_crons_wait_long_enough_to_learn_the_outcome.sql";

describe("HTTP crons declare a response timeout", () => {
  it("the inventory is real (cannot pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(CUTOFF);
    // The corpus must actually contain scheduled HTTP calls, or this guard is
    // asserting nothing at all.
    const withHttp = files.filter((f) =>
      readFileSync(join(DIR, f), "utf8").includes("net.http_post("));
    expect(withHttp.length).toBeGreaterThan(5);
  });

  it("no migration after the rewrite schedules an HTTP cron on the 5s default", () => {
    const offenders: string[] = [];

    for (const f of files) {
      if (f <= CUTOFF) continue;
      const sql = readFileSync(join(DIR, f), "utf8");
      // Comments describe; they do not schedule.
      const code = sql.replace(/--.*$/gm, "");
      if (!code.includes("cron.schedule")) continue;

      // Each cron.schedule(...) body, roughly: from the call to the statement end.
      for (const m of code.matchAll(/cron\.schedule\s*\(([\s\S]{0,2000}?)\)\s*;/g)) {
        const call = m[1];
        if (!call.includes("net.http_post(")) continue;       // a SQL-only cron needs no timeout
        if (call.includes("timeout_milliseconds")) continue;
        offenders.push(`${f}`);
        break;
      }
    }

    expect(
      offenders,
      "These migrations schedule an HTTP cron without `timeout_milliseconds`, so pg_net " +
        "waits pg_net's DEFAULT 5000ms — less than an edge function's cold start. The work " +
        "still happens; the OUTCOME is lost, and a slow 500 becomes indistinguishable from " +
        "a slow success. Pass `timeout_milliseconds := 90000` (Q1373):\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the rewrite migration is idempotent by construction", () => {
    // It must refuse to touch a command that already declares one, or a replay
    // would stack the argument and produce invalid SQL.
    const sql = readFileSync(join(DIR, CUTOFF), "utf8").replace(/--.*$/gm, "");
    expect(sql).toContain("command NOT LIKE '%timeout_milliseconds%'");
    // And it must refuse a command with two calls rather than half-rewrite it.
    expect(sql).toContain("more than one net.http_post call");
  });
});

// Proof this is able to fail: drop the NOT-LIKE guard and a replay would
// double-prepend the argument.
// @mutate supabase/migrations/20260922222716_http_crons_wait_long_enough_to_learn_the_outcome.sql | AND command NOT LIKE '%timeout_milliseconds%' | AND true

/**
 * Q1373: 30s was not long enough either. Two platform-side stalls (2026-09-25
 * 42.8s, 2026-10-05 60.4s, both runs answering a clean 200) were filed as
 * timeouts. Since 20261005171624 every HTTP cron waits at least 90s, and no
 * later migration may schedule one shorter.
 */
const RAISE = "20261005171624_http_crons_wait_90s_for_a_stalled_platform_call.sql";
const MIN_MS = 90000;

describe("HTTP crons wait long enough for a stalled platform call (Q1373)", () => {
  it("the raise migration rewrites 30000 to 90000, replay-safely", () => {
    expect(files).toContain(RAISE);
    const sql = blankSqlComments(readFileSync(join(DIR, RAISE), "utf8"));
    expect(sql).toMatch(/timeout_milliseconds\\s\*:=\\s\*30000\\M/);
    expect(sql).toContain("'timeout_milliseconds := 90000'");
    expect(sql).toContain("cron.alter_job");
  });

  it("no migration after it schedules an HTTP cron under 90s", () => {
    const later = files.filter((f) => f > RAISE);
    const offenders: string[] = [];
    for (const f of later) {
      const code = blankSqlComments(readFileSync(join(DIR, f), "utf8"));
      for (const m of code.matchAll(/timeout_milliseconds\s*:=\s*(\d+)/g)) {
        if (/cron\.(schedule|alter_job)\s*\(/.test(code) && code.includes("net.http_post(") && Number(m[1]) < MIN_MS) offenders.push(`${f}: ${m[1]}ms`);
      }
    }
    expect(offenders, `HTTP crons must pass timeout_milliseconds >= ${MIN_MS} (Q1373)`).toEqual([]);
  });
});
// @mutate supabase/migrations/20261005171624_http_crons_wait_90s_for_a_stalled_platform_call.sql | 'timeout_milliseconds := 90000' | 'timeout_milliseconds := 30000'
