/**
 * Jobs audit 11-08 #7 and #12, migration 20261108202000.
 *
 * Behaviour (real Postgres): src/test/pglite/noShowNoticeServerSide.pglite.mjs (2026-11-08: 10 PASS; 4 FAIL with
 * NEW_MIGRATION=skip; 4 plants each red).
 *
 * This guard holds the two halves together:
 *   - report_helper_no_show writes the Helpr's notice itself, with EXACTLY the words, type and link the
 *     create-notification 'no_show_reported' template builds (warning and restriction), so an older app build's own
 *     call is an exact duplicate the server drops instead of a second notice;
 *   - the app no longer sends it; a recurring visit's date is released for the no-show Helpr.
 *
 * @mutate supabase/migrations/20261111202421_no_show_report_opens_30_minutes_after_start.sql |          ELSE 'You received a no-show warning for "' |          ELSE 'You got a no-show warning for "'
 * @mutate supabase/migrations/20261111202421_no_show_report_opens_30_minutes_after_start.sql |     CASE WHEN v_result->>'action' = 'pending_ban_review' THEN 'warning' ELSE 'job_updates' END, |     'warning',
 * @mutate supabase/functions/_shared/notification-templates.ts |         type: legacyBanned \|\| restricted ? "warning" : "job_updates", |         type: "warning",
 * @mutate supabase/migrations/20261111202421_no_show_report_opens_30_minutes_after_start.sql |   IF v_parent_job_id IS NOT NULL THEN\n    v_released | IF false THEN\n    v_released
 * @mutate supabase/migrations/20261108202000_no_show_notice_server_side.sql |                     WHEN p_reason = 'no_show'\n |                     WHEN false\n
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { NOTIFICATION_TEMPLATES } from "../../supabase/functions/_shared/notification-templates";

const defs = effectiveDefs("supabase/migrations");
const rns = blankSqlComments(defs.get("report_helper_no_show")?.stmt ?? "").replace(/\s+/g, " ");
const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

function built(action: string) {
  const t = NOTIFICATION_TEMPLATES.no_show_reported;
  return t.build({ job: { id: "J", title: "TITLE", status: "open" } as any, senderRole: "poster", noShowAction: action } as any);
}

describe("the solo no-show notice is the server's (Jobs audit 11-08 #7)", () => {
  // 20261111202421 (F284) restates it with only GUARD 2 changed; the notice is unchanged.
  it("the newest report_helper_no_show (20261111202421, restated from 20261108202000) writes the Helpr's notice", () => {
    expect(defs.get("report_helper_no_show")?.file).toMatch(/^20261111202421_/);
    expect(rns).toMatch(/INSERT INTO public\.notifications \(user_id, title, message, type, link, job_id\) VALUES \( v_helper_id,/);
  });
  it("the warning is word for word the template's (type and link too)", () => {
    const w = built("warning")!;
    expect(rns).toContain(sqlStr(w.title));
    const [before, after] = w.message.split("TITLE");
    expect(rns).toContain(`ELSE ${sqlStr(before)} || COALESCE(NULLIF(btrim(v_job_title), ''), 'your job') || ${sqlStr(after)} END`);
    expect(w.type).toBe("job_updates");
    expect(rns).toContain("ELSE 'job_updates' END");
    expect(rns).toContain(sqlStr(w.link ?? ""));
  });
  it("the restriction is word for word the template's", () => {
    const r = built("pending_ban_review")!;
    expect(rns).toContain(`THEN ${sqlStr(r.title)}`);
    expect(rns).toContain(`THEN ${sqlStr(r.message)}`);
    expect(r.type).toBe("warning");
    expect(rns).toContain("THEN 'warning' ELSE 'job_updates' END");
  });
  it("the app sends no notice of its own", () => {
    const h = blankComments(readFileSync("src/components/job-card/activityActions/useLifecycleHandlers.ts", "utf8"));
    expect(h).not.toContain('template: "no_show_reported"');
  });
  it("a recurring visit's date goes back to the series for the no-show Helpr (#12)", () => {
    expect(rns).toMatch(/IF v_parent_job_id IS NOT NULL THEN v_released := public\.series_release_dates\(v_parent_job_id, v_helper_id, ARRAY\[v_date_needed\], 'no_show'/);
    expect(rns.indexOf("series_release_dates(")).toBeGreaterThan(rns.indexOf("UPDATE public.jobs SET status = 'open'"));
  });
  it("the poster reads that the Helpr didn't show up for the date, not that they gave it up", () => {
    const s = blankSqlComments(defs.get("series_release_dates")?.stmt ?? "").replace(/\s+/g, " ");
    expect(defs.get("series_release_dates")?.file).toMatch(/^20261108202000_/);
    expect(s).toContain("WHEN p_reason = 'no_show' THEN '%6$s didn''t show up for %1$s on \"%2$s\"%3$s.");
  });
});
