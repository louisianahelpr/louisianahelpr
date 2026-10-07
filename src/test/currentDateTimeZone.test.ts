/*
 * CLASS GUARD (Q1185 final review #1, 2026-10-03): every SQL function that
 * reads the date from the clock (CURRENT_DATE, now()::date, date(now()), ...)
 * pins TimeZone to America/Chicago.
 *
 * CURRENT_DATE is the SESSION's date, and prod sessions run in UTC, a day
 * ahead of Louisiana from 19:00 to 24:00 CDT. A job's date_needed is a
 * Louisiana date, so an unpinned `date_needed < CURRENT_DATE` calls a job
 * dated today "already passed" every evening. direct_accept_block_reason
 * (20261003214350) was written without the pin: from 19:00 CDT a ready
 * Helpr's tap on a same-day direct offer got "The date for this job has
 * already passed", and a pending one never completed (PGlite S10/S11, red on
 * the unpinned body at any hour). The six live readers were all pinned
 * (measured 2026-10-03), five of them by a later ALTER FUNCTION ... SET.
 *
 * Inventory: every function the migrations leave defined (effectiveDefs),
 * pinned in its own CREATE header or by a later ALTER FUNCTION. The same rule
 * runs on the replayed schema in db-smoke and on prod after every db-deploy
 * and nightly (scripts/ci/current-date-time-zone.sql via
 * scripts/check-live-privileges.mjs), where a dashboard edit would show.
 */
// @mutate supabase/migrations/20261007033530_seed_switch_hides_test_profiles.sql |  SET "TimeZone" TO 'America/Chicago'\nAS $fn$\nDECLARE\n  v_job record; | AS $fn$\nDECLARE\n  v_job record;
// @mutate scripts/check-live-privileges.mjs | coalesce((SELECT json_agg(o) FROM (${CURRENT_DATE_SQL}) o), '[]'::json) AS current_date_offenders, | '[]'::json AS current_date_offenders,
// @mutate .github/workflows/db-smoke.yml | -f scripts/ci/current-date-time-zone.sql) | -f /dev/null)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = join(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const PIN = /\bSET\s+"?timezone"?\s+(?:TO|=)\s+'America\/Chicago'/i;
/** The calendar date read from the clock, in every spelling scripts/ci/current-date-time-zone.sql matches. */
const READS_DATE =
  /\bcurrent_date\b|(?:\bnow\(\)|\bcurrent_timestamp\b|\blocaltimestamp\b|\btransaction_timestamp\(\)|\bstatement_timestamp\(\)|\bclock_timestamp\(\))\s*::\s*date\b|\bdate\s*\(\s*(?:now\(\)|current_timestamp|localtimestamp)\s*\)/i;

/** Functions a migration pins by ALTER FUNCTION ... SET timezone, with the file that does it. */
function alterPins(): { fn: string; file: string }[] {
  const out: { fn: string; file: string }[] = [];
  for (const file of readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()) {
    const code = blankSqlComments(readFileSync(join(MIG, file), "utf8"));
    for (const m of code.matchAll(/ALTER\s+FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\([^)]*\)\s+(SET\s+"?timezone"?\s+(?:TO|=)\s+'America\/Chicago')/gi)) {
      out.push({ fn: m[1], file });
    }
  }
  return out;
}

function readers(): { fn: string; file: string; pinned: boolean }[] {
  const pins = alterPins();
  const out: { fn: string; file: string; pinned: boolean }[] = [];
  for (const [fn, d] of effectiveDefs(MIG)) {
    const open = /\bAS\s+\$\w*\$/i.exec(d.stmt);
    if (!open) continue;
    const header = d.stmt.slice(0, open.index);
    if (!READS_DATE.test(blankSqlComments(d.stmt.slice(open.index)))) continue;
    // A CREATE OR REPLACE resets proconfig, so only an ALTER in a LATER file still pins it.
    const pinned = PIN.test(blankSqlComments(header)) || pins.some((p) => p.fn === fn && p.file > d.file);
    out.push({ fn, file: d.file, pinned });
  }
  return out;
}

describe("every function that reads CURRENT_DATE judges the date in Louisiana (Q1185 final review #1)", () => {
  it("each one pins TimeZone to America/Chicago, in its CREATE or by a later ALTER FUNCTION", () => {
    const found = readers();
    // seven today (six live + direct_accept_block_reason, 2026-10-03): the inventory must be real
    expect(found.length).toBeGreaterThanOrEqual(7);
    expect(found.filter((r) => !r.pinned).map((r) => `${r.fn} (${r.file})`), "reads CURRENT_DATE in the session's time zone").toEqual([]);
  });

  it("the same rule runs on the replayed schema before a deploy and on prod after it", () => {
    const sql = readFileSync(join(ROOT, "scripts/ci/current-date-time-zone.sql"), "utf8");
    expect(sql).toContain("\\mcurrent_date\\M");
    expect(sql).toContain("\\s*::\\s*date\\M");
    expect(sql).toContain("\\mdate\\s*\\(\\s*(now\\(\\)|current_timestamp|localtimestamp)\\s*\\)");
    expect(sql).toMatch(/lower\(c\) = 'timezone=america\/chicago'/);
    expect(readFileSync(join(ROOT, "scripts/check-live-privileges.mjs"), "utf8")).toContain(
      "coalesce((SELECT json_agg(o) FROM (${CURRENT_DATE_SQL}) o), '[]'::json) AS current_date_offenders,",
    );
    const smoke = readFileSync(join(ROOT, ".github/workflows/db-smoke.yml"), "utf8");
    expect(smoke).toContain("-f scripts/ci/current-date-time-zone.sql)");
    expect(smoke).toContain('- "scripts/ci/current-date-time-zone.sql"');
    expect(readFileSync(join(ROOT, ".github/workflows/db-deploy.yml"), "utf8")).toContain('- "scripts/ci/current-date-time-zone.sql"');
  });
});
