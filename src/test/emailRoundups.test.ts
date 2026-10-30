/**
 * Email pacing (owner 2026-10-25): applicant emails = the first at once, then
 * at most one roundup every 3 hours; job-match emails = at most one a
 * Louisiana day, the rest in one email the next morning. Measured before: 50
 * applicant emails to one poster on 10-22; up to 4 job-match emails to one
 * Helpr on 10-21. Behaviour is proven in src/test/pglite/emailRoundups.pglite.mjs;
 * this guard pins the two call sites that consult it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";

const read = (p: string) => readFileSync(p, "utf8");
const MIGRATIONS = "supabase/migrations";
/** The newest migration that schedules `job` (cron.schedule by name replaces the job). */
const newestSchedule = (job: string): string => {
  const hits = migrationFiles(MIGRATIONS)
    .map((f) => read(join(MIGRATIONS, f)))
    .filter((sql) => sql.includes(`cron.schedule('${job}'`));
  expect(hits.length, job).toBeGreaterThan(0);
  return hits[hits.length - 1];
};

describe("email pacing", () => {
  it("notify_on_application emails only when the poster's applicant email should not wait", () => {
    // The NEWEST notify_on_application (restated by 20261030135219, UX-3), not the file that added the gate.
    const sql = effectiveDefs(MIGRATIONS).get("notify_on_application")!.stmt;
    // @mutate supabase/migrations/20261030135219_applicant_nudges_and_filled_notice.sql | IF COALESCE(v_email_enabled, true) AND NOT public.application_email_should_wait(v_user_id) THEN | IF COALESCE(v_email_enabled, true) THEN
    expect(sql).toMatch(/IF COALESCE\(v_email_enabled, true\) AND NOT public\.application_email_should_wait\(v_user_id\) THEN/);
    // The in-app notice is still written for every applicant, before the email decision.
    const ins = sql.indexOf("INSERT INTO public.notifications (user_id, title, message, type, link)");
    const gate = sql.indexOf("public.application_email_should_wait(v_user_id)");
    expect(ins).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(ins);
  });

  it("send-notification-email holds a job-match email back unless it is the morning roundup", () => {
    const fn = read("supabase/functions/send-notification-email/index.ts");
    // @mutate supabase/functions/send-notification-email/index.ts | if (category === 'job_matches' && (body as { roundup?: unknown })?.roundup !== true) { | if (false) {
    expect(fn).toMatch(/if \(category === 'job_matches' && \(body as \{ roundup\?: unknown \}\)\?\.roundup !== true\) \{/);
    expect(fn).toMatch(/supabase\.rpc\('job_match_email_should_wait', \{ p_user_id: user_id \}\)/);
    expect(fn).toMatch(/reason: 'daily_roundup'/);
  });

  it("both roundups run on a schedule and the job-match roundup is flagged so it is not held back itself", () => {
    expect(newestSchedule("application-roundups")).toMatch(/cron\.schedule\('application-roundups', '8,38 \* \* \* \*'/);
    expect(newestSchedule("job-match-roundups")).toMatch(/cron\.schedule\('job-match-roundups', '5 13 \* \* \*'/);
    // @mutate supabase/migrations/20261025182522_application_email_roundup.sql | 'roundup', true | 'roundup', false
    expect(effectiveDefs(MIGRATIONS).get("send_job_match_roundups")!.stmt).toMatch(/'roundup', true/);
  });
});
