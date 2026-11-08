/**
 * Jobs audit 11-08 #2 (High) and #6 (Medium), migration 20261108201000.
 *
 * Behaviour (real Postgres): src/test/pglite/jobsNoticesEmail.pglite.mjs (2026-11-08: 34 PASS; 28 FAIL with
 * NEW_MIGRATION=skip; 7 plants each red).
 *
 * This guard holds the CLASS on the effective definitions:
 *   - every title the email matcher lists is written by a live sender (SQL or edge), so the list cannot rot into
 *     titles nobody sends;
 *   - every party notice the Jobs senders below write is on the list (the schedule-change, dispute, cancel, hire and
 *     payout senders), so a new notice from them cannot be push-only again;
 *   - the admins' "Job disputed" is never on it (test disputes must never mail the owner);
 *   - the three restated senders never skip the in-app row on a switch (#6).
 *
 * @mutate supabase/migrations/20261108201000_jobs_notices_email.sql |       'Date or time request withdrawn', 'New date or time not applied', 'Your new time wasn''t answered') THEN 'job_updates' |       'Date or time request withdrawn', 'New date or time not applied') THEN 'job_updates'
 * @mutate supabase/migrations/20261108201000_jobs_notices_email.sql |     WHEN p_type = 'work_status' AND p_title IN ('Start time passed', 'Job day ended', 'Please review the work') THEN 'work_status' |     WHEN p_type = 'work_status' AND p_title IN ('Start time passed', 'Job day ended', 'Please review the work', 'Job disputed') THEN 'work_status'
 * @mutate supabase/migrations/20261108201000_jobs_notices_email.sql |     WHEN p_type = 'financial_alerts' AND p_title IN ('Job funded', 'Payout released', 'You received a tip!') THEN p_type |     WHEN p_type = 'financial_alerts' AND p_title IN ('Job funded', 'Payout released', 'You received a tip!', 'Nobody sends this') THEN p_type
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs("supabase/migrations");
const body = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "");
const sqlLits = (s: string) => [...s.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));

const matcher = body("jobs_notice_email_type");
/** The exact titles the matcher lists (IN lists only; the LIKE patterns are checked separately). */
const listed = [...matcher.matchAll(/p_title IN \(([^)]*)\)/g)].flatMap((m) => sqlLits(m[1]));

function edgeSources(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name) && !/test/.test(e.name)) out.push(blankComments(readFileSync(p, "utf8")));
    }
  };
  walk("supabase/functions");
  return out.join("\n");
}
const EDGE = edgeSources();
/** Every live SQL function but the matcher itself (its own list would vouch for its titles). */
const ALL_SQL = [...defs.entries()].filter(([n]) => n !== "jobs_notice_email_type").map(([, d]) => blankSqlComments(d.stmt)).join("\n");

describe("Jobs notices email (Jobs audit 11-08 #2)", () => {
  it("the matcher lists a real set", () => {
    expect(listed.length).toBeGreaterThan(20);
    expect(defs.get("jobs_notice_email_type")?.file).toMatch(/^20261108201000_/);
  });
  it("every listed title is written by a live sender (SQL or edge)", () => {
    const missing = listed.filter((t) => !ALL_SQL.includes(`'${t.replace(/'/g, "''")}'`) && !EDGE.includes(`"${t}"`));
    expect(missing).toEqual([]);
  });
  it("the check-in patterns are the endings continue_day_check_in writes", () => {
    const ci = body("continue_day_check_in");
    for (const end of [" is on the way back", " is back at the job", " started working again"]) {
      expect(ci).toContain(`v_name || '${end}'`);
      expect(matcher).toContain(`p_title LIKE '%${end}'`);
    }
  });
  it("every party notice the Jobs senders write is on the list", () => {
    const SENDERS = ["request_job_schedule_change", "respond_job_schedule_change", "withdraw_job_schedule_change",
      "notify_schedule_change_expired", "expire_unanswered_schedule_changes", "poster_cancel_job"];
    const titles = new Set<string>();
    for (const s of SENDERS) {
      const b = body(s);
      expect(b, s).not.toBe("");
      for (const m of b.matchAll(/INSERT INTO public\.notifications[\s\S]*?;/g)) {
        for (const t of sqlLits(m[0])) if (/^[A-Z][A-Za-z' —!]{6,60}$/.test(t) && !/^(The |Your job$|A job$|FM)/.test(t)) titles.add(t);
      }
    }
    expect(titles.size).toBeGreaterThan(8);
    expect([...titles].filter((t) => !listed.includes(t))).toEqual([]);
    for (const t of ["Job funded", "Payout released", "A dispute was opened", "Revision deadline passed — dispute opened"]) expect(listed).toContain(t);
  });
  it("never the admins' dispute notice", () => {
    expect(listed).not.toContain("Job disputed");
    const trg = blankSqlComments(readFileSync("supabase/migrations/20261108201000_jobs_notices_email.sql", "utf8"));
    expect(trg).toMatch(/CREATE TRIGGER trg_email_jobs_notice[\s\S]*?NOT LIKE '\/admin%'/);
  });
});

describe("a switch never deletes the in-app row (Jobs audit 11-08 #6)", () => {
  for (const fn of ["notify_on_payment_escrowed", "notify_helper_on_tip", "notify_user_on_review"]) {
    it(`${fn} writes the row whatever the switch`, () => {
      const b = body(fn);
      expect(b).toContain("INSERT INTO public.notifications");
      expect(b).not.toMatch(/IF COALESCE\(v_pref, true\) THEN/);
      expect(b).not.toMatch(/INTO v_pref/);
    });
  }
});
