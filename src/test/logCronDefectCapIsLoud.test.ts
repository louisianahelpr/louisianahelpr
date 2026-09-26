/**
 * GUARD (CJ-007 follow-up): log_cron_defect's hourly cap is never silent.
 *
 * THE BUG: past 20 defect rows per function per hour, log_cron_defect only
 * RAISE WARNINGed, which nothing reads, so 300 failures showed as 20 and the
 * other 280 left no trace. Fixed by 20260926043528_log_cron_defect_cap_alerts.
 *
 * Reads the NEWEST definition (effective, with rewrites): its cap branch must
 * write a 'defect-cap' error_logs row (INSERT) and count later drops (UPDATE
 * ... 'dropped'), and the cap must not count its own cap row.
 *
 * @mutate supabase/migrations/20260926043528_log_cron_defect_cap_alerts.sql |     IF NOT FOUND THEN\n      INSERT INTO public.error_logs | IF false THEN\n      INSERT INTO public.error_logs
 * @mutate supabase/migrations/20260926043528_log_cron_defect_cap_alerts.sql |        AND e.tags->>'ref' IS DISTINCT FROM 'defect-cap'\n | \n
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const body = blankSqlComments(effectiveDefs(join(process.cwd(), "supabase", "migrations")).get("log_cron_defect")?.stmt ?? "");
const capBranch = /\)\s*>=\s*20\s+THEN([\s\S]*?)\n {2}END IF;/.exec(body)?.[1] ?? "";

describe("log_cron_defect's cap is loud", () => {
  it("finds the cap branch in the newest definition", () => {
    expect(body.length).toBeGreaterThan(200);
    expect(capBranch.length).toBeGreaterThan(50);
  });

  it("past the cap it files one 'defect-cap' row and counts every drop", () => {
    expect(capBranch).toMatch(/IF\s+NOT\s+FOUND\s+THEN\s+INSERT\s+INTO\s+public\.error_logs[\s\S]*'ref',\s*'defect-cap'/);
    expect(capBranch).toMatch(/UPDATE\s+public\.error_logs[\s\S]*'dropped'/);
  });

  it("the cap does not count its own cap row", () => {
    const count = body.slice(0, body.indexOf(capBranch));
    expect(count).toMatch(/tags->>'ref'\s+IS\s+DISTINCT\s+FROM\s+'defect-cap'/);
  });
});
